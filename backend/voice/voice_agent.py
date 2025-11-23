"""
Voice agent implementation for interview practice sessions.
"""

import logging
import os
import sys
import tempfile
import json
import asyncio
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv

from livekit.agents import Agent, AgentSession, JobContext, JobProcess, ChatContext
from livekit.agents import RoomInputOptions, WorkerOptions, cli
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.plugins import aws, elevenlabs, deepgram
from livekit.plugins.elevenlabs import VoiceSettings

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import Config
from prompts import INTERVIEW_CONDUCTOR_PROMPT
from services.rag_service import RAGService

# Global RAG service instance
_GLOBAL_RAG_SERVICE = None

load_dotenv()

logger = logging.getLogger("voice_agent")
console = logging.getLogger("console")


class InterviewAssistant(Agent):
    """Interview practice assistant agent"""
    
    def __init__(self, chat_ctx: ChatContext, rag_tool=None) -> None:
        tools = []
        if rag_tool:
            tools.append(rag_tool)
        
        super().__init__(
            chat_ctx=chat_ctx,
            instructions=INTERVIEW_CONDUCTOR_PROMPT,
            tools=tools,
        )


def prewarm(proc: JobProcess):
    """Prewarm the voice agent with necessary models and services."""
    global _GLOBAL_RAG_SERVICE
    
    logger.info("Starting prewarm process...")
    
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.45,
        activation_threshold=0.5,
    )
    logger.info("✅ VAD model loaded")
    
    # Initialize RAG Service
    if _GLOBAL_RAG_SERVICE is None:
        _GLOBAL_RAG_SERVICE = RAGService()
        logger.info("✅ RAG Service initialized")
    
    logger.info("✅ Prewarm completed")


def _create_llm_instance():
    """Create LLM instance using AWS Bedrock"""
    return aws.LLM(
        model=Config.BEDROCK_MODEL_ID,
        region=Config.AWS_REGION,
        temperature=Config.TEMPERATURE,
    )


def _create_agent_session(ctx: JobContext, llm_instance):
    """Create AgentSession with all required components"""
    return AgentSession(
        stt="deepgram/nova-3:multi",
        llm=llm_instance,
        tts=elevenlabs.TTS(
            voice_id="ZUrEGyu8GFMwnHbvLhv2",
            model="eleven_flash_v2_5",
            api_key=Config.ELEVENLABS_API_KEY,
            inactivity_timeout=180,
            voice_settings=VoiceSettings(
                stability=0.5,
                similarity_boost=0.5,
                speed=0.87
            ),
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=False,
        allow_interruptions=True,
    )


def _extract_user_name_from_job_metadata(ctx: JobContext) -> Optional[str]:
    """Extract user name from job metadata"""
    try:
        job_metadata = getattr(ctx, 'job', None)
        if job_metadata:
            metadata = getattr(job_metadata, 'metadata', None)
            if metadata:
                if isinstance(metadata, str):
                    metadata_dict = json.loads(metadata)
                elif isinstance(metadata, dict):
                    metadata_dict = metadata
                else:
                    return None
                
                user_name = metadata_dict.get('user_name')
                if user_name:
                    logger.info(f"Extracted user name from job metadata: {user_name}")
                    return user_name
    except Exception as e:
        logger.warning(f"Could not extract user name from job metadata: {e}")
    return None


async def _extract_user_name_from_participant(ctx: JobContext) -> Optional[str]:
    """Extract user name from participant metadata"""
    try:
        if not ctx.room.isconnected:
            await ctx.connect()
        
        remote_participants = list(ctx.room.remote_participants.values())
        for participant in remote_participants:
            meta = getattr(participant, 'metadata', None)
            if meta:
                try:
                    if isinstance(meta, str):
                        meta_dict = json.loads(meta)
                    else:
                        meta_dict = meta
                    
                    user_name = meta_dict.get('user_name')
                    if user_name:
                        logger.info(f"Extracted user name from participant: {user_name}")
                        return user_name
                except Exception:
                    pass
            
            name = getattr(participant, 'name', None)
            if name:
                logger.info(f"Extracted user name from participant name: {name}")
                return name
    except Exception as e:
        logger.warning(f"Could not extract user name from participant: {e}")
    return None


async def _extract_user_name(ctx: JobContext) -> Optional[str]:
    """Extract user name from various sources"""
    user_name = _extract_user_name_from_job_metadata(ctx)
    
    if not user_name:
        user_name = await _extract_user_name_from_participant(ctx)
    
    return user_name


async def _generate_personalized_greeting(llm_instance, user_name: Optional[str]) -> str:
    if user_name:
        return f"Hello {user_name}! I'm Nila, your AI interview practice partner. I'm here to help you prepare for your interview. Let's begin!"
    else:
        return "Hello! I'm Nila, your AI interview practice partner. I'm here to help you prepare for your interview. Let's begin!"


async def entrypoint(ctx: JobContext):
    """Main entrypoint for the voice agent"""
    global _GLOBAL_RAG_SERVICE
    
    ctx.log_context_fields = {"room": ctx.room.name}
    
    logger.info(f"Starting interview agent for room: {ctx.room.name}")
    logger.info("✅ Agent name: Nila (displayed in frontend)")
    
    await ctx.connect()
    
    room_name = ctx.room.name
    
    logger.info(f"🏠 Room name: {room_name}")
    
    user_name = await _extract_user_name(ctx)
    job_description = None
    user_name_for_rag = None
    
    # Extract user_name and job_description from job metadata or participant metadata
    metadata_dict = {}
    
    # Try job metadata first
    try:
        job_obj = getattr(ctx, 'job', None)
        if job_obj:
            metadata = getattr(job_obj, 'metadata', None)
            logger.info(f"🔍 Job metadata type: {type(metadata)}, value: {str(metadata)[:200] if metadata else 'None'}")
            
            if metadata and str(metadata).strip() and str(metadata).strip().lower() != "none":
                if isinstance(metadata, str):
                    try:
                        metadata_dict = json.loads(metadata)
                    except json.JSONDecodeError as e:
                        logger.error(f"❌ Failed to parse job metadata JSON: {e}, raw: {metadata[:100]}")
                elif isinstance(metadata, dict):
                    metadata_dict = metadata
    except Exception as e:
        logger.warning(f"Could not extract from job metadata: {e}")
    
    # Try participant metadata as fallback
    if not metadata_dict or not metadata_dict.get('job_description'):
        try:
            # Try remote participants
            for participant in ctx.room.remote_participants.values():
                participant_meta = getattr(participant, 'metadata', None)
                if participant_meta:
                    try:
                        if isinstance(participant_meta, str):
                            part_meta_dict = json.loads(participant_meta)
                        else:
                            part_meta_dict = participant_meta
                        
                        # Merge participant metadata (prefer job metadata if both exist)
                        if not metadata_dict:
                            metadata_dict = part_meta_dict
                        else:
                            metadata_dict.update({k: v for k, v in part_meta_dict.items() if k not in metadata_dict})
                        logger.info(f"🔍 Found participant metadata with keys: {list(part_meta_dict.keys())}")
                        break
                    except Exception as e:
                        logger.debug(f"Could not parse participant metadata: {e}")
        except Exception as e:
            logger.debug(f"Could not extract from participant metadata: {e}")
    
    # Extract values from metadata_dict
    if metadata_dict:
        user_name_from_metadata = metadata_dict.get('user_name')
        job_description = metadata_dict.get('job_description')
        
        logger.info(f"🔍 Extracted from metadata - user_name: {user_name_from_metadata}, job_description length: {len(job_description) if job_description else 0}")
        logger.info(f"🔍 Full metadata dict keys: {list(metadata_dict.keys())}")
        
        # Use user_name from metadata if available, otherwise use extracted user_name
        user_name_for_rag = user_name_from_metadata or user_name
        
        if user_name_for_rag and _GLOBAL_RAG_SERVICE:
            _GLOBAL_RAG_SERVICE.set_user_context(user_name_for_rag, None)
            logger.info(f"✅ Set RAG context for user_name: {user_name_for_rag}")
        
        if job_description and job_description.strip():
            logger.info(f"📄 Job description provided (length: {len(job_description)} chars) - will be included in prompt context")
        else:
            logger.warning(f"⚠️ No job_description found in metadata or it's empty. Available keys: {list(metadata_dict.keys())}")
    else:
        logger.warning(f"⚠️ No metadata found in job or participant metadata")
    
    # Final fallback: ensure RAG context is set if we have user_name
    if not user_name_for_rag and user_name and _GLOBAL_RAG_SERVICE:
        _GLOBAL_RAG_SERVICE.set_user_context(user_name, None)
        logger.info(f"✅ Set RAG context using fallback user_name: {user_name}")
    
    if user_name:
        logger.info(f"👤 User name: {user_name}")
    else:
        logger.info("👤 User name: Not available")
    
    llm_instance = _create_llm_instance()
    session = _create_agent_session(ctx, llm_instance)
    
    initial_ctx = ChatContext()
    
    # Set agent identity
    initial_ctx.add_message(
        role="system",
        content="Your name is Nila. Always refer to yourself as Nila. Never use any other name like Alex or any other name. When introducing yourself, always say 'I'm Nila' or 'I'm Nila, your AI interview practice partner'."
    )
    
    if user_name:
        initial_ctx.add_message(
            role="assistant",
            content=f"The candidate's name is {user_name}. Remember to use their name naturally throughout the interview."
        )
    
    # Add job description directly to context if provided
    if job_description and job_description.strip():
        initial_ctx.add_message(
            role="system",
            content=f"""JOB DESCRIPTION:
{job_description.strip()}

Use this job description to:
- Ask relevant questions based on the role requirements
- Evaluate answers against job expectations
- Provide feedback aligned with what the role demands
- Reference specific skills or qualifications mentioned in the job description"""
        )
        logger.info(f"✅ Job description added to prompt context (length: {len(job_description)} chars)")
    else:
        logger.warning("⚠️ No job description available - agent will conduct general interview practice")
    
    # Add context about resume RAG tool if available
    if user_name and _GLOBAL_RAG_SERVICE:
        initial_ctx.add_message(
            role="system",
            content="The candidate may have uploaded their resume. Use the search_candidate_info tool to access their background, skills, and experience for personalized questions. Use this tool autonomously when you need specific details from their resume."
        )
    
    # Get RAG tool if available
    rag_tool = None
    if _GLOBAL_RAG_SERVICE:
        rag_tool = _GLOBAL_RAG_SERVICE.get_rag_function_tool()
        logger.info("✅ RAG tool added to agent")
    
    assistant = InterviewAssistant(chat_ctx=initial_ctx, rag_tool=rag_tool)
    
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )
    
    logger.info("✅ Interview session started")
    
    greeting = await _generate_personalized_greeting(llm_instance, user_name)
    await session.say(greeting)


def run_voice_agent():
    """Run the voice agent"""
    config_status = Config.validate_config()
    if not config_status["valid"]:
        logger.error(f"Configuration issues: {config_status['issues']}")
        return
    
    if config_status["warnings"]:
        logger.warning(f"Configuration warnings: {config_status['warnings']}")
    
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm))


if __name__ == "__main__":
    run_voice_agent()

