"""
Feedback generation service for interview sessions
"""

import logging
import boto3
from typing import Dict, Any, Optional, List
from datetime import datetime

from config.settings import Config

logger = logging.getLogger(__name__)


class FeedbackService:
    """Service for generating interview feedback"""
    
    def __init__(self):
        aws_config = Config.get_aws_config()
        self.bedrock = boto3.client("bedrock-runtime", **aws_config)
        # Use Claude Haiku for feedback generation (same as main LLM)
        self.model_id = Config.BEDROCK_MODEL_ID
        if not self.model_id:
            logger.warning("⚠️ BEDROCK_MODEL_ID not configured - feedback generation will fail")
        logger.info(f"✅ FeedbackService initialized with model: {self.model_id}")
    
    async def generate_feedback(
        self,
        session_id: str,
        user_name: str,
        transcript: List[Dict[str, Any]],
        job_description: Optional[str] = None,
        interview_mode: str = "mock-interview"
    ) -> Dict[str, Any]:
        """
        Generate concise, structured feedback for an interview session
        
        Args:
            session_id: Unique session identifier (used for tracking and storage)
            user_name: Name of the candidate (used in prompt and stored in feedback)
            transcript: List of conversation messages with roles and content (converted to readable text)
            job_description: Optional job description (included in prompt for context-aware feedback)
            interview_mode: Interview mode (mock-interview or practice) - included as context in prompt
        
        Returns:
            Dictionary containing structured feedback with sections, scores, and recommendations
        """
        try:
            # Build conversation context from transcript
            conversation_text = self._build_conversation_text(transcript)
            
            # Create feedback prompt
            feedback_prompt = self._create_feedback_prompt(
                user_name=user_name,
                conversation_text=conversation_text,
                job_description=job_description,
                interview_mode=interview_mode
            )
            
            # Generate feedback using Bedrock
            feedback_text = await self._generate_with_bedrock(feedback_prompt)
            
            # Parse and structure feedback
            structured_feedback = self._parse_feedback(feedback_text, session_id, user_name)
            
            logger.info(f"✅ Feedback generated for session: {session_id}")
            return structured_feedback
            
        except Exception as e:
            logger.error(f"❌ Error generating feedback: {e}", exc_info=True)
            raise
    
    def _build_conversation_text(self, transcript: List[Dict[str, Any]]) -> str:
        """Build readable conversation text from transcript"""
        conversation_lines = []
        for msg in transcript:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")
            timestamp = msg.get("timestamp", "")
            
            if role == "user":
                conversation_lines.append(f"[Candidate] {content}")
            elif role == "assistant":
                conversation_lines.append(f"[Interviewer] {content}")
            elif role == "system":
                continue  # Skip system messages
            
        return "\n".join(conversation_lines)
    
    def _create_feedback_prompt(
        self,
        user_name: str,
        conversation_text: str,
        job_description: Optional[str],
        interview_mode: str
    ) -> str:
        """Create prompt for feedback generation"""
        
        prompt = f"""You are an expert interview evaluator providing concise, structured feedback for the interview sessions.

Candidate Name: {user_name}
Interview Mode: {interview_mode}

{"Job Description: " + job_description if job_description else "No specific job description provided."}

Interview Transcript:
{conversation_text}

Provide SHORT, CONCISE feedback in the following structured format. Keep each section brief (2-3 sentences max per point):

## Overall Performance Summary
[2-3 sentences summarizing overall performance and interview outcome]

## Strengths (with Scores)
For each strength, provide:
- Strength name: Brief description (Score: X/10)
- Keep to 3-5 key strengths maximum

## Areas for Improvement
[Identify specific areas that need improvement with actionable recommendations]

## Communication Skills
[Evaluate clarity, articulation, listening skills, and overall communication effectiveness]

## Technical Knowledge
[Assess depth of technical knowledge, accuracy of answers, and problem-solving approach]

## Question-by-Question Analysis
[Brief analysis of key questions and answers, highlighting what was done well and what could be improved]

## Specific Recommendations
[Provide concrete, actionable recommendations for improvement]

## Overall Rating
[Provide ratings out of 10 for: Communication, Technical Knowledge, Problem-Solving, Overall Performance]

Format your response clearly with proper sections and bullet points. Be constructive, specific, actionable and provide precise and concise feedback on the areas of improvement and strengths in a short summary."""

        return prompt
    
    async def _generate_with_bedrock(self, prompt: str) -> str:
        """Generate feedback using AWS Bedrock"""
        import json
        
        try:
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,  
                "temperature": 0.5,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            })
            
            response = self.bedrock.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType="application/json",
                accept="application/json"
            )
            
            response_body = json.loads(response.get("body").read())
            
            # Extract text from response
            if "content" in response_body:
                content = response_body["content"]
                if isinstance(content, list) and len(content) > 0:
                    if "text" in content[0]:
                        return content[0]["text"]
            
            # Fallback: try to get text directly
            return str(response_body)
            
        except Exception as e:
            logger.error(f"Error calling Bedrock: {e}", exc_info=True)
            raise
    
    def _parse_feedback(self, feedback_text: str, session_id: str, user_name: str) -> Dict[str, Any]:
        """Parse and structure feedback text into a structured format"""
        
        return {
            "session_id": session_id,
            "user_name": user_name,
            "feedback_text": feedback_text,
            "generated_at": datetime.now().isoformat(),
            "sections": self._extract_sections(feedback_text)
        }
    
    def _extract_sections(self, feedback_text: str) -> Dict[str, str]:
        """Extract sections from feedback text"""
        sections = {}
        current_section = None
        current_content = []
        
        lines = feedback_text.split("\n")
        
        for line in lines:
            # Check if line is a section header
            if line.strip().startswith("##"):
                # Save previous section
                if current_section:
                    sections[current_section] = "\n".join(current_content).strip()
                
                # Start new section
                current_section = line.strip().replace("##", "").strip()
                current_content = []
            else:
                if current_section:
                    current_content.append(line)
        
        # Save last section
        if current_section:
            sections[current_section] = "\n".join(current_content).strip()
        
        return sections

