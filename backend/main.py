"""
FastAPI Backend for Interview Practice Agent
"""

import logging
import os
import uuid
import asyncio
import json
from datetime import datetime, timezone
from typing import Dict, Optional, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config.settings import Config
from services.rag_service import RAGService
from services.document_parser import DocumentParser
from models.feedback import FeedbackModel
from config.database import get_database

rag_service = RAGService()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""
    logger.info("Starting backend initialization...")
    
    try:
        from config.database import get_database, DatabaseConfig
        from models.feedback import FeedbackModel
        
        db = await get_database()
        collection = db[FeedbackModel.COLLECTION_NAME]
        FeedbackModel.create_indexes(collection)
        
        count = await collection.count_documents({})
        logger.info(f"MongoDB connected: {DatabaseConfig.MONGODB_URL}")
        logger.info(f"Database: {DatabaseConfig.MONGODB_DB_NAME}")
        logger.info(f"Collection: {FeedbackModel.COLLECTION_NAME}")
        logger.info(f"Existing feedback documents: {count}")
    except Exception as e:
        logger.warning(f"MongoDB connection failed at startup: {e}")
        logger.warning("Feedback features will not be available until MongoDB is connected")
    
    logger.info("Backend initialized successfully")
    yield
    
    try:
        from config.database import close_database
        await close_database()
    except Exception as e:
        logger.warning(f"Error closing database connection: {e}")
    
    logger.info("Backend shutdown complete")


app = FastAPI(
    title="Interview Practice Agent API",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_sessions: Dict[str, Dict] = {}
pending_resumes: Dict[str, str] = {}


class InterviewRoomRequest(BaseModel):
    """Request to create an interview room"""
    user_name: Optional[str] = Field(None, description="User name")
    job_description: Optional[str] = Field(None, description="Job description text")
    resume_id: Optional[str] = Field(None, description="Resume ID if already uploaded")
    language: str = Field(default="en-US", description="Language code")
    mode: Optional[str] = Field(default="practice", description="Interview mode: 'practice' or 'mock-interview'")


class ResumeUploadResponse(BaseModel):
    """Response for resume upload"""
    success: bool
    resume_id: str
    message: str


class InterviewRoomResponse(BaseModel):
    """Response with room creation details"""
    success: bool
    session_id: str
    room_name: str
    token: str
    livekit_url: str
    user_name: Optional[str]
    language: str
    expires_in: int


def generate_livekit_token(room_name: str, participant_identity: str, participant_name: str, metadata: Optional[Dict[str, Any]] = None) -> str:
    """Generate LiveKit JWT token for participant access"""
    try:
        from livekit import api
        import json
        
        if not Config.LIVEKIT_API_KEY or not Config.LIVEKIT_API_SECRET or not Config.LIVEKIT_URL:
            raise ValueError("LiveKit credentials not configured")
        
        token = api.AccessToken(
            api_key=Config.LIVEKIT_API_KEY,
            api_secret=Config.LIVEKIT_API_SECRET,
        )
        
        token.with_identity(participant_identity)
        if participant_name:
            token.with_name(participant_name)
        
        if metadata:
            try:
                token.with_metadata(json.dumps(metadata))
            except Exception as e:
                logger.warning(f"Failed to attach metadata to token: {e}")
        
        token.with_grants(api.VideoGrants(
            room_join=True,
            room=room_name,
            can_publish=True,
            can_subscribe=True,
            can_publish_data=True,
        ))
        
        jwt_token = token.to_jwt()
        logger.info(f"Generated token for {participant_identity} in room {room_name}")
        
        return jwt_token
    except Exception as e:
        logger.error(f"Error generating LiveKit token: {e}")
        raise


def is_livekit_available() -> bool:
    """Check if LiveKit is available"""
    return bool(Config.LIVEKIT_URL and Config.LIVEKIT_API_KEY and Config.LIVEKIT_API_SECRET)


@app.post("/api/interview/upload-resume", response_model=ResumeUploadResponse)
async def upload_resume(
    file: UploadFile = File(...),
    user_name: Optional[str] = Form(None)
):
    """Upload and index resume"""
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="No file provided")
        
        file_content = await file.read()
        parser = DocumentParser()
        resume_text = parser.parse_document(file_content, file.filename)
        
        if not resume_text:
            raise HTTPException(status_code=400, detail="Could not extract text from resume")
        
        resume_id = str(uuid.uuid4())
        
        if user_name:
            asyncio.create_task(rag_service.index_resume(user_name, resume_text, resume_id))
            logger.info(f"Resume uploaded and indexing started: resume_id={resume_id}, user_name={user_name}")
            message = "Resume uploaded successfully. Indexing in progress..."
        else:
            pending_resumes[resume_id] = resume_text
            logger.info(f"Resume uploaded (pending indexing): resume_id={resume_id}")
            message = "Resume uploaded successfully. It will be indexed when you start the interview session."
        
        return ResumeUploadResponse(
            success=True,
            resume_id=resume_id,
            message=message
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Resume upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Resume upload failed: {str(e)}")


@app.post("/api/interview/create-room", response_model=InterviewRoomResponse)
async def create_interview_room(request: InterviewRoomRequest):
    """Create LiveKit room for interview session"""
    try:
        if not is_livekit_available():
            raise HTTPException(status_code=500, detail="LiveKit not available")
        
        room_name = f"interview-{uuid.uuid4().hex[:8]}"
        session_id = str(uuid.uuid4())
        
        user_name = request.user_name or "Candidate"
        identity = f"user-{session_id[:8]}"
        
        if request.resume_id and request.resume_id in pending_resumes:
            resume_text = pending_resumes.pop(request.resume_id)
            asyncio.create_task(rag_service.index_resume(user_name, resume_text, request.resume_id))
            logger.info(f"Indexing pending resume: resume_id={request.resume_id}, user_name={user_name}")
        
        rag_service.set_user_context(user_name, None)
        logger.info(f"Set RAG context: user_name={user_name}")
        
        token_metadata = {
            "user_name": user_name,
            "session_id": session_id,
            "mode": request.mode or "practice",
        }
        
        if request.job_description:
            token_metadata["job_description"] = request.job_description
            logger.info(f"Job description included in token metadata (length: {len(request.job_description)} chars)")
        else:
            logger.info("No job description provided")
        
        if request.resume_id:
            token_metadata["resume_id"] = request.resume_id
        
        logger.info(f"Interview mode: {request.mode or 'practice'}")
        
        jwt_token = generate_livekit_token(
            room_name=room_name,
            participant_identity=identity,
            participant_name=user_name,
            metadata=token_metadata
        )
        
        active_sessions[session_id] = {
            "session_id": session_id,
            "user_name": user_name,
            "room_name": room_name,
            "job_description": request.job_description,
            "resume_id": request.resume_id,
            "created_at": datetime.now(),
            "language": request.language,
            "status": "active"
        }
        
        logger.info(f"Created interview room: {room_name} for user: {user_name}")
        
        return InterviewRoomResponse(
            success=True,
            session_id=session_id,
            room_name=room_name,
            token=jwt_token,
            livekit_url=Config.LIVEKIT_URL,
            user_name=user_name,
            language=request.language,
            expires_in=7200
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Interview room creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Interview room creation failed: {str(e)}")


@app.get("/api/interview/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session details"""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return active_sessions[session_id]


@app.get("/api/interview/sessions")
async def list_sessions():
    """List all active sessions"""
    return {
        "active_sessions": len(active_sessions),
        "sessions": [
            {
                "session_id": sid,
                "user_name": session.get("user_name"),
                "room_name": session.get("room_name"),
                "created_at": session.get("created_at").isoformat() if session.get("created_at") else None,
                "status": session.get("status")
            }
            for sid, session in active_sessions.items()
        ]
    }


@app.delete("/api/interview/sessions/{session_id}")
async def end_session(session_id: str):
    """End interview session"""
    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = active_sessions[session_id]
    del active_sessions[session_id]
    
    logger.info(f"Ended interview session: {session_id}")
    
    return {
        "success": True,
        "message": "Session ended successfully",
        "session_id": session_id
    }


@app.get("/api/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/feedback/user")
async def get_all_feedback_fallback(limit: int = 100):
    """Get all feedback entries"""
    try:
        db = await get_database()
        if db is None:
            raise HTTPException(status_code=503, detail="MongoDB connection unavailable. Please ensure MongoDB is running.")
        
        collection = db[FeedbackModel.COLLECTION_NAME]
        feedbacks = await FeedbackModel.get_all_feedback(collection, limit)
        
        logger.info(f"Retrieved {len(feedbacks)} feedback entries (all users)")
        
        return {
            "success": True,
            "feedbacks": feedbacks,
            "count": len(feedbacks)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving all feedback: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve feedback: {str(e)}")


@app.get("/api/feedback/user/{user_name}")
async def get_user_feedback(user_name: str, limit: int = 100):
    """Get all feedback for a user"""
    try:
        db = await get_database()
        if db is None:
            raise HTTPException(status_code=503, detail="MongoDB connection unavailable. Please ensure MongoDB is running.")
        
        collection = db[FeedbackModel.COLLECTION_NAME]
        feedbacks = await FeedbackModel.get_feedback_by_user(collection, user_name, limit)
        
        logger.info(f"Retrieved {len(feedbacks)} feedback entries for user: {user_name}")
        
        return {
            "success": True,
            "feedbacks": feedbacks,
            "count": len(feedbacks)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving user feedback for {user_name}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to retrieve feedback: {str(e)}")


@app.get("/api/feedback/{session_id}")
async def get_feedback(session_id: str):
    """Get feedback for a specific session"""
    try:
        db = await get_database()
        collection = db[FeedbackModel.COLLECTION_NAME]
        feedback = await FeedbackModel.get_feedback_by_session(collection, session_id)
        
        if not feedback:
            raise HTTPException(status_code=404, detail="Feedback not found")
        
        return {
            "success": True,
            "feedback": feedback
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving feedback: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve feedback: {str(e)}")


@app.get("/api/feedback")
async def get_all_feedback(limit: int = 50):
    """Get all feedback"""
    try:
        db = await get_database()
        collection = db[FeedbackModel.COLLECTION_NAME]
        feedbacks = await FeedbackModel.get_all_feedback(collection, limit)
        
        return {
            "success": True,
            "feedbacks": feedbacks,
            "count": len(feedbacks)
        }
    except Exception as e:
        logger.error(f"Error retrieving feedback: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to retrieve feedback: {str(e)}")


@app.get("/api/")
async def root():
    """Root endpoint"""
    return {
        "message": "Interview Practice Agent API",
        "version": "1.0.0",
        "status": "running"
    }




if __name__ == "__main__":
    import uvicorn
    host = os.getenv("UVICORN_HOST", "0.0.0.0")
    port = int(os.getenv("UVICORN_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)

