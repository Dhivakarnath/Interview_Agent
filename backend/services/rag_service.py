"""
RAG Service for Interview Practice Agent
Handles resume and job description retrieval using Qdrant and Titan embeddings
"""

import logging
import json
import boto3
import asyncio
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from qdrant_client import QdrantClient, AsyncQdrantClient, models

from config.settings import Config

logger = logging.getLogger("rag_service")


@dataclass
class SearchResult:
    """Search result with metadata"""
    id: str
    score: float
    metadata: Dict[str, Any]
    
    @property
    def text(self) -> str:
        return self.metadata.get("text", "")
    
    @property
    def source(self) -> str:
        return self.metadata.get("source", "")


class RAGService:
    """
    RAG Service for resume and job description retrieval
    """
    
    def __init__(self):
        aws_config = Config.get_aws_config()
        self.bedrock = boto3.client("bedrock-runtime", **aws_config)
        
        if Config.QDRANT_URL:
            self.qdrant = QdrantClient(
                url=Config.QDRANT_URL, 
                api_key=Config.QDRANT_API_KEY if Config.QDRANT_API_KEY else None
            )
            self.aqdrant = AsyncQdrantClient(
                url=Config.QDRANT_URL, 
                api_key=Config.QDRANT_API_KEY if Config.QDRANT_API_KEY else None
            )
            logger.info(f"Qdrant connected: {Config.QDRANT_URL}")
        else:
            self.qdrant = None
            self.aqdrant = None
            logger.warning("QDRANT_URL not configured - resume indexing disabled")
        
        self.collection_name = Config.QDRANT_COLLECTION_PREFIX
        self._current_user_name: Optional[str] = None
        self._current_job_description: Optional[str] = None
        logger.info(f"RAGService initialized with collection: '{self.collection_name}'")
    
    async def embed_text(self, text: str, dimensions: int = None, normalize: bool = None) -> List[float]:
        """Generate Titan v2 embeddings directly from Bedrock."""
        dimensions = dimensions or Config.EMBEDDING_DIMENSION
        normalize = normalize if normalize is not None else Config.EMBEDDING_NORMALIZE
        
        body = json.dumps({
            "inputText": text, 
            "dimensions": dimensions, 
            "normalize": normalize
        })
        
        try:
            response = self.bedrock.invoke_model(
                body=body,
                modelId=Config.BEDROCK_EMBEDDING_MODEL_ID,
                accept="application/json",
                contentType="application/json"
            )
            result = json.loads(response["body"].read())
            await asyncio.sleep(0)
            return result["embedding"]
        except Exception as e:
            logger.error(f"Error generating embeddings: {e}")
            raise
    
    async def index_resume(self, user_name: str, resume_text: str, resume_id: str) -> bool:
        """Index resume text in Qdrant with Titan embeddings"""
        if not self.aqdrant:
            logger.warning("Qdrant not available - cannot index resume")
            return False
        try:
            await self._ensure_collection_exists()
            await self._ensure_payload_indexes()
            
            chunks = self._chunk_text(resume_text, chunk_size=500)
            
            points = []
            for idx, chunk in enumerate(chunks):
                embedding = await self.embed_text(chunk)
                point_id = f"{resume_id}_{idx}"
                
                point = models.PointStruct(
                    id=hash(point_id) % (2**63),
                    vector={
                        "text-dense": embedding
                    },
                    payload={
                        "text": chunk,
                        "source": "resume",
                        "user_name": user_name,
                        "resume_id": resume_id,
                        "chunk_index": idx,
                        "total_chunks": len(chunks)
                    }
                )
                points.append(point)
            
            await self.aqdrant.upsert(
                collection_name=self.collection_name,
                points=points
            )
            
            logger.info(f"Indexed {len(points)} resume chunks for user {user_name}")
            return True
            
        except Exception as e:
            logger.error(f"Error indexing resume: {e}")
            return False
    
    async def search_resume(self, query: str, user_name: str, top_k: int = 3) -> List[SearchResult]:
        """Search user's resume for relevant information"""
        return await self._search_collection(query, user_name, "resume", top_k)
    
    async def search_all(self, query: str, user_name: str, top_k: int = 5) -> List[SearchResult]:
        """Search resume (job description is passed directly in prompts, not indexed)"""
        return await self._search_collection(query, user_name, "resume", top_k)
    
    async def _search_collection(self, query: str, user_name: str, source_filter: Optional[str], top_k: int) -> List[SearchResult]:
        """Internal method to search Qdrant collection"""
        if not self.aqdrant:
            logger.warning("Qdrant not available - cannot search")
            return []
        try:
            query_vector = await self.embed_text(query)
            
            filter_conditions = [
                models.FieldCondition(
                    key="user_name",
                    match=models.MatchValue(value=user_name)
                )
            ]
            
            if source_filter:
                filter_conditions.append(
                    models.FieldCondition(
                        key="source",
                        match=models.MatchValue(value=source_filter)
                    )
                )
            
            search_params = {
                "collection_name": self.collection_name,
                "query_vector": models.NamedVector(
                    name="text-dense",
                    vector=query_vector
                ),
                "limit": top_k,
                "with_payload": True,
                "query_filter": models.Filter(must=filter_conditions) if filter_conditions else None
            }
            
            results = await self.aqdrant.search(**search_params)
            
            search_results = []
            for hit in results:
                search_results.append(SearchResult(
                    id=str(hit.id),
                    score=hit.score,
                    metadata=hit.payload or {}
                ))
            
            logger.info(f"Found {len(search_results)} relevant documents for query: '{query[:50]}...'")
            return search_results
            
        except Exception as e:
            logger.error(f"Error during Qdrant search: {e}")
            return []
    
    def _chunk_text(self, text: str, chunk_size: int = 500) -> List[str]:
        """Split text into chunks"""
        paragraphs = text.split('\n\n')
        chunks = []
        current_chunk = ""
        
        for para in paragraphs:
            if len(current_chunk) + len(para) < chunk_size:
                current_chunk += para + "\n\n"
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = para + "\n\n"
        
        if current_chunk:
            chunks.append(current_chunk.strip())
        
        return chunks
    
    async def _ensure_collection_exists(self):
        """Ensure Qdrant collection exists with proper configuration"""
        if not self.aqdrant:
            return
        try:
            collections = await self.aqdrant.get_collections()
            collection_names = [col.name for col in collections.collections]
            
            if self.collection_name not in collection_names:
                await self.aqdrant.create_collection(
                    collection_name=self.collection_name,
                    vectors_config={
                        "text-dense": models.VectorParams(
                            size=Config.EMBEDDING_DIMENSION,
                            distance=models.Distance.COSINE
                        )
                    }
                )
                logger.info(f"Created collection: {self.collection_name}")
            
            await self._ensure_payload_indexes()
        except Exception as e:
            logger.error(f"Error ensuring collection exists: {e}")
            raise
    
    async def _ensure_payload_indexes(self):
        """Ensure payload indexes exist for user_name and source fields"""
        if not self.qdrant:
            return
        
        try:
            try:
                self.qdrant.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="user_name",
                    field_schema="keyword"
                )
                logger.info("Created index on 'user_name' field")
            except Exception as e:
                if "already exists" not in str(e).lower() and "index" not in str(e).lower():
                    logger.debug(f"Index on 'user_name' already exists or error: {e}")
            
            try:
                self.qdrant.create_payload_index(
                    collection_name=self.collection_name,
                    field_name="source",
                    field_schema="keyword"
                )
                logger.info("Created index on 'source' field")
            except Exception as e:
                if "already exists" not in str(e).lower():
                    logger.debug(f"Index on 'source' already exists or error: {e}")
        except Exception as e:
            logger.warning(f"Error creating payload indexes: {e}")
    
    def set_user_context(self, user_name: str, job_description: Optional[str] = None):
        """Set current user context for RAG searches"""
        self._current_user_name = user_name
        self._current_job_description = job_description
    
    def get_rag_function_tool(self, is_mock_interview: bool = False):
        """
        Get the RAG search function tool for the voice agent.
        """
        from livekit.agents import function_tool
        
        if is_mock_interview:
            tool_description = """
            Search the candidate's resume for relevant information.
            CRITICAL: Use this tool COMPLETELY SILENTLY - NEVER mention "searching", "looking up", "fetching", "checking", or "reviewing" the resume.
            NEVER say phrases like "Let me search your resume" or "I'll look up your resume" - just use the information naturally in your questions.
            Use this tool silently when you need to:
            - Understand the candidate's background, skills, or experience
            - Reference specific details from their resume
            - Ask personalized questions based on their experience
            
            After using this tool, ask questions naturally as if you already knew the information - do NOT mention that you searched for it.
            """
        else:
            tool_description = """
            Search the candidate's resume for relevant information.
            Use this tool when you need to:
            - Understand the candidate's background, skills, or experience
            - Reference specific details from their resume
            - Ask personalized questions based on their experience
            - Provide guidance based on their profile
            
            Note: Job description is provided directly in the conversation context, 
            so use this tool primarily for searching the candidate's resume.
            """
        
        @function_tool(description=tool_description)
        async def search_candidate_info(query: str) -> str:
            """
            Search the candidate's resume for relevant information.
            Use this tool SILENTLY when you need specific details from their resume.
            Do NOT mention "looking up" or "fetching" from resume - use the information naturally.
            Use this tool when you need to:
            - Understand the candidate's background, skills, or experience
            - Reference specific details from their resume
            - Ask personalized questions based on their experience
            
            Note: Job description is provided directly in the conversation context, 
            so use this tool primarily for searching the candidate's resume.
            """
            try:
                logger.info(f"RAG TOOL CALLED with query: '{query}'")
                logger.info(f"Current user_name: {self._current_user_name}")
                
                if not self._current_user_name:
                    logger.warning("No user_name set in RAG service")
                    return "I don't have access to your resume. Please upload it to get personalized guidance."
                
                search_results = await self.search_resume(query, self._current_user_name, top_k=5)
                
                logger.info(f"Search results: {len(search_results)} found for user_name: {self._current_user_name}")
                
                if not search_results:
                    logger.warning(f"No search results found for user_name: {self._current_user_name}, query: {query}")
                    return "I couldn't find relevant information in your resume for this query. The resume may still be indexing, or it might not contain information matching your query."
                
                formatted_results = []
                for result in search_results:
                    text = result.text[:300]
                    formatted_results.append(text)
                
                logger.info(f"Returning {len(formatted_results)} resume chunks")
                return "\n\n".join(formatted_results)
                
            except Exception as e:
                logger.error(f"Error in search_candidate_info tool: {e}", exc_info=True)
                return "Sorry, I encountered an error while searching for information. Please try again."
        
        return search_candidate_info

