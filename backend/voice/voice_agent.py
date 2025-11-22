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

load_dotenv()

logger = logging.getLogger("voice_agent")
console = logging.getLogger("console")


class InterviewAssistant(Agent):
    """Interview practice assistant agent"""
    
    def __init__(self, chat_ctx: ChatContext) -> None:
        super().__init__(
            chat_ctx=chat_ctx,
            instructions=INTERVIEW_CONDUCTOR_PROMPT,
        )


def prewarm(proc: JobProcess):
    """Prewarm the voice agent with necessary models and services."""
    logger.info("Starting prewarm process...")
    
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.45,
        activation_threshold=0.5,
    )
    logger.info("✅ VAD model loaded")
    
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
    """Generate personalized greeting using LLM"""
    try:
        if user_name:
            prompt = f"""Generate a warm, professional greeting for an interview practice session. 
IMPORTANT: Your name is Nila. Always introduce yourself as "I'm Nila" or "I'm Nila, your AI interview practice partner".
The candidate's name is {user_name}. 
Keep it brief (1-2 sentences), friendly but professional.
Start with greeting the candidate by name and introduce yourself as Nila."""
        else:
            prompt = """Generate a warm, professional greeting for an interview practice session. 
IMPORTANT: Your name is Nila. Always introduce yourself as "I'm Nila" or "I'm Nila, your AI interview practice partner".
The candidate's name is not available yet.
Keep it brief (1-2 sentences), friendly but professional.
Welcome them to the interview practice session and introduce yourself as Nila."""
        
        from livekit.agents import llm
        
        chat_ctx = llm.ChatContext().append(
            role="user",
            content=prompt
        )
        
        stream = llm_instance.chat(ctx=chat_ctx)
        
        greeting_parts = []
        async for chunk in stream:
            if hasattr(chunk, 'content'):
                greeting_parts.append(chunk.content)
            elif isinstance(chunk, str):
                greeting_parts.append(chunk)
            else:
                greeting_parts.append(str(chunk))
        
        greeting = "".join(greeting_parts).strip()
        
        if greeting:
            return greeting
    except Exception as e:
        logger.warning(f"Could not generate personalized greeting: {e}")
    
    if user_name:
        return f"Hello {user_name}! I'm Nila, your AI interview practice partner. I'm here to help you prepare for your interview. Let's begin!"
    else:
        return "Hello! I'm Nila, your AI interview practice partner. I'm here to help you prepare for your interview. Let's begin!"


async def entrypoint(ctx: JobContext):
    """Main entrypoint for the voice agent"""
    ctx.log_context_fields = {"room": ctx.room.name}
    
    logger.info(f"Starting interview agent for room: {ctx.room.name}")
    logger.info("✅ Agent name: Nila (displayed in frontend)")
    
    await ctx.connect()
    
    room_name = ctx.room.name
    
    logger.info(f"🏠 Room name: {room_name}")
    
    user_name = await _extract_user_name(ctx)
    
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
    
    assistant = InterviewAssistant(chat_ctx=initial_ctx)
    
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

