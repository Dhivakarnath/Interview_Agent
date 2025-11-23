"""
MongoDB models for feedback storage
"""

from typing import Optional, Dict, Any, List
from datetime import datetime
from pymongo import IndexModel
from pymongo.collection import Collection


class FeedbackModel:
    """Model for storing interview feedback"""
    
    COLLECTION_NAME = "feedback"
    
    @staticmethod
    def create_indexes(collection: Collection):
        """Create indexes for feedback collection"""
        indexes = [
            IndexModel([("session_id", 1)], unique=True),
            IndexModel([("user_name", 1)]),
            IndexModel([("created_at", -1)]),
        ]
        collection.create_indexes(indexes)
    
    @staticmethod
    def create_feedback_document(
        session_id: str,
        user_name: str,
        feedback_data: Dict[str, Any],
        job_description: Optional[str] = None,
        interview_mode: str = "mock-interview"
    ) -> Dict[str, Any]:
        """Create a feedback document"""
        return {
            "session_id": session_id,
            "user_name": user_name,
            "job_description": job_description,
            "interview_mode": interview_mode,
            "feedback_text": feedback_data.get("feedback_text", ""),
            "sections": feedback_data.get("sections", {}),
            "created_at": datetime.now(),
            "updated_at": datetime.now(),
        }
    
    @staticmethod
    async def save_feedback(
        collection: Collection,
        session_id: str,
        user_name: str,
        feedback_data: Dict[str, Any],
        job_description: Optional[str] = None,
        interview_mode: str = "mock-interview"
    ) -> str:
        """Save feedback to MongoDB"""
        document = FeedbackModel.create_feedback_document(
            session_id=session_id,
            user_name=user_name,
            feedback_data=feedback_data,
            job_description=job_description,
            interview_mode=interview_mode
        )
        
        # Use upsert to update if exists, insert if new
        result = await collection.update_one(
            {"session_id": session_id},
            {"$set": document},
            upsert=True
        )
        
        return str(result.upserted_id) if result.upserted_id else session_id
    
    @staticmethod
    async def get_feedback_by_session(collection: Collection, session_id: str) -> Optional[Dict[str, Any]]:
        """Get feedback by session ID"""
        feedback = await collection.find_one({"session_id": session_id})
        if feedback:
            # Convert ObjectId to string
            feedback["_id"] = str(feedback["_id"])
        return feedback
    
    @staticmethod
    async def get_feedback_by_user(collection: Collection, user_name: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get all feedback for a user"""
        cursor = collection.find({"user_name": user_name}).sort("created_at", -1).limit(limit)
        feedbacks = await cursor.to_list(length=limit)
        
        # Convert ObjectId to string
        for feedback in feedbacks:
            feedback["_id"] = str(feedback["_id"])
        
        return feedbacks
    
    @staticmethod
    async def get_all_feedback(collection: Collection, limit: int = 50) -> List[Dict[str, Any]]:
        """Get all feedback"""
        cursor = collection.find({}).sort("created_at", -1).limit(limit)
        feedbacks = await cursor.to_list(length=limit)
        
        # Convert ObjectId to string
        for feedback in feedbacks:
            feedback["_id"] = str(feedback["_id"])
        
        return feedbacks

