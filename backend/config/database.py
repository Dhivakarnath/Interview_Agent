"""
Database configuration and connection utilities
"""

import logging
import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConnectionFailure
from typing import Optional

logger = logging.getLogger(__name__)

class DatabaseConfig:
    """Database configuration"""
    
    MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "interview_agent")
    
    _client: Optional[AsyncIOMotorClient] = None
    _database = None

async def get_database():
    """Get database connection"""
    global DatabaseConfig
    
    if DatabaseConfig._database is None:
        try:
            DatabaseConfig._client = AsyncIOMotorClient(DatabaseConfig.MONGODB_URL)
            DatabaseConfig._database = DatabaseConfig._client[DatabaseConfig.MONGODB_DB_NAME]
            await DatabaseConfig._client.admin.command('ping')
            logger.info("✅ MongoDB connected successfully")
        except ConnectionFailure as e:
            logger.error(f"❌ MongoDB connection failed: {e}")
            raise
    
    return DatabaseConfig._database

async def close_database():
    """Close database connection"""
    global DatabaseConfig
    
    if DatabaseConfig._client:
        DatabaseConfig._client.close()
        DatabaseConfig._database = None
        DatabaseConfig._client = None
        logger.info("✅ Database connection closed")

