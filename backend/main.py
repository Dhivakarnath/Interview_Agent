"""
FastAPI Backend for Interview Practice Agent
Handles API endpoints for frontend integration
"""

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional, Any

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config.settings import Config

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""
    logger.info("✅ Backend initialized successfully")
    logger.info("📝 Sessions stored in memory (MongoDB not required for basic functionality)")
    yield
    logger.info("✅ Backend shutdown complete")


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


class InterviewRoomRequest(BaseModel):
    """Request to create an interview room"""
    user_name: Optional[str] = Field(None, description="User name")
    job_description: Optional[str] = Field(None, description="Job description text")
    language: str = Field(default="en-US", description="Language code")


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
        logger.info(f"✅ Generated token for {participant_identity} in room {room_name}")
        
        return jwt_token
    except Exception as e:
        logger.error(f"Error generating LiveKit token: {e}")
        raise


def is_livekit_available() -> bool:
    """Check if LiveKit is available"""
    return bool(Config.LIVEKIT_URL and Config.LIVEKIT_API_KEY and Config.LIVEKIT_API_SECRET)


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
        
        jwt_token = generate_livekit_token(
            room_name=room_name,
            participant_identity=identity,
            participant_name=user_name,
            metadata={
                "user_name": user_name,
                "session_id": session_id,
                "job_description": request.job_description
            }
        )
        
        active_sessions[session_id] = {
            "session_id": session_id,
            "user_name": user_name,
            "room_name": room_name,
            "job_description": request.job_description,
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

