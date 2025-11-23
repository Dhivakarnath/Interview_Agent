"""
Configuration settings for the Interview Practice Agent system
"""

import os
from typing import Dict, Any
from dotenv import load_dotenv

load_dotenv()

class Config:
    """Central configuration class"""
    
    # AWS / Bedrock Configuration
    AWS_REGION = os.getenv("AWS_REGION", "")
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN", "")
    
    # Bedrock Models
    BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "")
    BEDROCK_EMBEDDING_MODEL_ID = os.getenv(
        "BEDROCK_EMBEDDING_MODEL_ID", 
        "amazon.titan-embed-text-v2:0"
    )
    
    # Embedding Configuration
    EMBEDDING_DIMENSION = int(os.getenv("EMBEDDING_DIMENSION", "1024"))
    EMBEDDING_NORMALIZE = os.getenv("EMBEDDING_NORMALIZE", "true").lower() == "true"
    
    # LLM Configuration
    TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.5"))
    MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1000"))
    
    # LiveKit Configuration
    LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
    LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
    LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
    
    # Concurrency limit for agent sessions
    MAX_AGENT_SESSIONS = int(os.getenv("MAX_AGENT_SESSIONS", "10"))
    
    # STT/TTS Configuration
    DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
    ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
    
    # Vector Database Configuration
    QDRANT_URL = os.getenv("QDRANT_URL", "")
    QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
    QDRANT_COLLECTION_PREFIX = os.getenv("QDRANT_COLLECTION_PREFIX", "candidate_resumes")
    
    # MongoDB Configuration
    MONGODB_URL = os.getenv("MONGODB_URL", "")
    MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "interview_agent")
    
    
    # Performance Configuration
    REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))
    
    @classmethod
    def get_aws_config(cls) -> Dict[str, str]:
        """Get AWS configuration"""
        config = {
            "region_name": cls.AWS_REGION
        }
        if cls.AWS_ACCESS_KEY_ID:
            config["aws_access_key_id"] = cls.AWS_ACCESS_KEY_ID
        if cls.AWS_SECRET_ACCESS_KEY:
            config["aws_secret_access_key"] = cls.AWS_SECRET_ACCESS_KEY
        if cls.AWS_SESSION_TOKEN:
            config["aws_session_token"] = cls.AWS_SESSION_TOKEN
        return config
    
    @classmethod
    def validate_config(cls) -> Dict[str, Any]:
        """Validate configuration and return status"""
        issues = []
        warnings = []
        
        if not cls.QDRANT_URL:
            warnings.append("QDRANT_URL not configured - resume search disabled")
        
        try:
            import boto3
            session = boto3.Session()
            credentials = session.get_credentials()
            if not credentials:
                warnings.append("AWS credentials not configured - Bedrock features will not work")
        except Exception:
            warnings.append("AWS credentials not configured - Bedrock features will not work")
        
        if not cls.LIVEKIT_URL:
            warnings.append("LIVEKIT_URL not configured - voice features disabled")
        if not cls.DEEPGRAM_API_KEY:
            warnings.append("DEEPGRAM_API_KEY not configured - STT disabled")
        if not cls.ELEVENLABS_API_KEY:
            warnings.append("ELEVENLABS_API_KEY not configured - TTS disabled")
        
        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings
        }

