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
    """Get database connection with retry logic"""
    global DatabaseConfig
    
    if DatabaseConfig._database is None:
        try:
            logger.info(f"Connecting to MongoDB: {DatabaseConfig.MONGODB_URL}")
            logger.info(f"Database name: {DatabaseConfig.MONGODB_DB_NAME}")
            
            DatabaseConfig._client = AsyncIOMotorClient(
                DatabaseConfig.MONGODB_URL,
                serverSelectionTimeoutMS=5000
            )
            DatabaseConfig._database = DatabaseConfig._client[DatabaseConfig.MONGODB_DB_NAME]
            
            await DatabaseConfig._client.admin.command('ping')
            logger.info(f"MongoDB connected successfully to database: {DatabaseConfig.MONGODB_DB_NAME}")
            
            collections = await DatabaseConfig._database.list_collection_names()
            logger.info(f"Available collections: {collections}")
            
        except Exception as e:
            logger.error(f"MongoDB connection failed: {e}")
            logger.error(f"URL: {DatabaseConfig.MONGODB_URL}")
            logger.error(f"Database: {DatabaseConfig.MONGODB_DB_NAME}")
            DatabaseConfig._client = None
            DatabaseConfig._database = None
            raise
    
    try:
        await DatabaseConfig._client.admin.command('ping')
    except Exception as e:
        logger.warning(f"MongoDB connection lost, reconnecting...: {e}")
        DatabaseConfig._client = None
        DatabaseConfig._database = None
        return await get_database()
    
    return DatabaseConfig._database

async def close_database():
    """Close database connection"""
    global DatabaseConfig
    
    if DatabaseConfig._client:
        DatabaseConfig._client.close()
        DatabaseConfig._database = None
        DatabaseConfig._client = None
        logger.info("Database connection closed")

