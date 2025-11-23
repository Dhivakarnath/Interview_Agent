"""
Video analysis service using AWS Bedrock multimodal capabilities
for body language and coding analysis
"""

import logging
import base64
import json
import boto3
from typing import Optional, Dict, Any
from io import BytesIO
from PIL import Image

from config.settings import Config

logger = logging.getLogger("video_analysis_service")


class VideoAnalysisService:
    """Service for analyzing video frames using AWS Bedrock multimodal"""
    
    def __init__(self):
        aws_config = Config.get_aws_config()
        self.bedrock = boto3.client("bedrock-runtime", **aws_config)
        self.model_id = Config.BEDROCK_MODEL_ID
        logger.info("✅ VideoAnalysisService initialized")
    
    def _image_to_base64(self, image_data: bytes) -> str:
        """Convert image bytes to base64 string"""
        return base64.b64encode(image_data).decode('utf-8')
    
    async def analyze_body_language(self, image_data: bytes, context: Optional[str] = None) -> Optional[str]:
        """
        Analyze body language from a video frame using Bedrock multimodal
        
        Args:
            image_data: Image bytes from video frame
            context: Optional context about what the candidate is doing
            
        Returns:
            Analysis result as string, or None if analysis fails
        """
        try:
            # Convert image to base64
            base64_image = self._image_to_base64(image_data)
            
            # Prepare prompt for body language analysis
            prompt = """Analyze this image of a candidate during an interview practice session. 
Focus on:
1. Posture and body positioning
2. Eye contact and gaze direction
3. Facial expressions (confidence, nervousness, engagement)
4. Hand gestures and body language
5. Overall presence and professionalism

Provide 2-3 specific, actionable suggestions for improvement. Be encouraging and constructive.
Keep it brief (2-3 sentences max) and frame feedback positively.

Example format: "I notice [observation]. [Suggestion]. [Encouragement]."
"""
            
            if context:
                prompt += f"\n\nContext: {context}"
            
            # Prepare messages for Claude
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64_image
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ]
            
            # Call Bedrock
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 300,
                "messages": messages
            }
            
            response = self.bedrock.invoke_model(
                modelId=self.model_id,
                body=json.dumps(body)
            )
            
            response_body = json.loads(response.get('body').read())
            
            # Extract text from response
            if "content" in response_body and len(response_body["content"]) > 0:
                content = response_body["content"][0]
                if content.get("type") == "text":
                    analysis = content.get("text", "").strip()
                    logger.info(f"✅ Body language analysis completed: {analysis[:100]}...")
                    return analysis
            
            logger.warning("⚠️ No analysis text found in Bedrock response")
            return None
            
        except Exception as e:
            logger.error(f"❌ Error analyzing body language: {e}")
            return None
    
    async def analyze_code(self, image_data: bytes, context: Optional[str] = None) -> Optional[str]:
        """
        Analyze code from a screen share frame using Bedrock multimodal
        
        Args:
            image_data: Image bytes from screen share frame
            context: Optional context about what the candidate is coding
            
        Returns:
            Analysis result as string, or None if analysis fails
        """
        try:
            # Convert image to base64
            base64_image = self._image_to_base64(image_data)
            
            # Prepare prompt for code analysis
            prompt = """Analyze this code screenshot from a candidate's screen during an interview practice session.
Focus on:
1. Code quality and structure
2. Potential bugs or issues
3. Optimization opportunities
4. Best practices and improvements
5. Problem-solving approach

Provide 2-3 specific, actionable suggestions. Be encouraging and teach them.
Keep it brief (2-3 sentences max) and frame feedback constructively.

Example format: "I see you're [approach]. [Suggestion]. [Teaching point]."
"""
            
            if context:
                prompt += f"\n\nContext: {context}"
            
            # Prepare messages for Claude
            messages = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": base64_image
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ]
            
            # Call Bedrock
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 300,
                "messages": messages
            }
            
            response = self.bedrock.invoke_model(
                modelId=self.model_id,
                body=json.dumps(body)
            )
            
            response_body = json.loads(response.get('body').read())
            
            # Extract text from response
            if "content" in response_body and len(response_body["content"]) > 0:
                content = response_body["content"][0]
                if content.get("type") == "text":
                    analysis = content.get("text", "").strip()
                    logger.info(f"✅ Code analysis completed: {analysis[:100]}...")
                    return analysis
            
            logger.warning("⚠️ No analysis text found in Bedrock response")
            return None
            
        except Exception as e:
            logger.error(f"❌ Error analyzing code: {e}")
            return None

