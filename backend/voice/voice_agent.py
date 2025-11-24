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

from livekit.agents import Agent, AgentSession, JobContext, JobProcess, ChatContext, ChatMessage
from livekit.agents import RoomInputOptions, WorkerOptions, cli
from livekit.agents import get_job_context
from livekit.agents import metrics
from livekit.agents.metrics import TTSMetrics
from livekit import rtc
from livekit.plugins import noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel
from livekit.plugins import aws, elevenlabs, deepgram
from livekit.plugins.elevenlabs import VoiceSettings

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import Config
from prompts import INTERVIEW_CONDUCTOR_PROMPT, MOCK_INTERVIEW_PROMPT
from services.rag_service import RAGService

# Global RAG service instance
_GLOBAL_RAG_SERVICE = None

load_dotenv()

logger = logging.getLogger("voice_agent")
console = logging.getLogger("console")


class InterviewAssistant(Agent):
    """Interview practice assistant agent with video frame sampling"""
    
    def __init__(self, chat_ctx: ChatContext, rag_tool=None, instructions=None, interview_mode: str = "practice") -> None:
        tools = []
        if rag_tool:
            tools.append(rag_tool)
        
        # Use provided instructions or default to practice prompt
        prompt = instructions or INTERVIEW_CONDUCTOR_PROMPT
        
        super().__init__(
            chat_ctx=chat_ctx,
            instructions=prompt,
            tools=tools,
        )
        
        # Video frame sampling state
        self._latest_camera_frame = None
        self._latest_screen_frame = None
        self._camera_stream = None
        self._screen_stream = None
        self._video_tasks = []
        self._interview_mode = interview_mode
        self._last_question_time = None
        self._silence_check_task = None
        self._last_screen_content_hash = None  # Track screen content changes
        self._session_context = None  # Store session context for silence checks
        self._agent_session = None  # Store agent session for silence checks
        self._is_checking_silence = False  # Flag to prevent duplicate silence checks
        self._transcript = []  # Track conversation transcript for feedback
        self._session_id = None  # Store session ID for feedback
        self._user_name = None  # Store user name for feedback
        self._job_description = None  # Store job description for feedback
        self._user_is_speaking = False  # Track if user is currently speaking
    
    async def on_enter(self):
        """Called when agent enters the room - set up video streams and audio tracking"""
        room = get_job_context().room
        
        # Find video tracks from remote participants (non-blocking)
        for participant in room.remote_participants.values():
            for publication in participant.track_publications.values():
                if publication.track and publication.track.kind == rtc.TrackKind.KIND_VIDEO:
                    # Create task without awaiting to avoid blocking job acceptance
                    asyncio.create_task(self._create_video_stream(publication.track, publication.source))
        
        # Watch for new video tracks
        def on_track_subscribed(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_VIDEO:
                asyncio.create_task(self._create_video_stream(track, publication.source))
        
        room.on("track_subscribed", on_track_subscribed)
        
        # For mock interviews, also track audio tracks to detect when agent finishes speaking
        if self._interview_mode == "mock-interview":
            import time
            
            def on_track_unsubscribed_audio(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
                """Track when agent audio ends"""
                if track.kind == rtc.TrackKind.KIND_AUDIO:
                    # Check if this is the agent (local participant is the agent)
                    if participant.identity == room.local_participant.identity:
                        self._last_question_time = time.time()
                        logger.info(f"Agent finished speaking (via on_enter track_unsubscribed), timestamp updated: {self._last_question_time}")
            
            room.on("track_unsubscribed", on_track_unsubscribed_audio)
    
    async def _create_video_stream(self, track: rtc.Track, source: int):
        """Create a video stream to sample frames from a track"""
        SOURCE_CAMERA = 1
        SOURCE_SCREEN_SHARE = 3
        
        # Close existing stream if switching sources
        if source == SOURCE_CAMERA:
            if self._camera_stream is not None:
                await self._camera_stream.aclose()
            self._camera_stream = rtc.VideoStream(track)
            logger.info("Created camera video stream")
            
            async def read_camera_stream():
                async for event in self._camera_stream:
                    # Store the latest frame for use in chat context
                    self._latest_camera_frame = event.frame
            
            task = asyncio.create_task(read_camera_stream())
            task.add_done_callback(lambda t: self._video_tasks.remove(t) if t in self._video_tasks else None)
            self._video_tasks.append(task)
            
        elif source == SOURCE_SCREEN_SHARE:
            if self._screen_stream is not None:
                await self._screen_stream.aclose()
            self._screen_stream = rtc.VideoStream(track)
            logger.info("Created screen share video stream")
            
            async def read_screen_stream():
                async for event in self._screen_stream:
                    # Store the latest frame for use in chat context
                    self._latest_screen_frame = event.frame
            
            task = asyncio.create_task(read_screen_stream())
            task.add_done_callback(lambda t: self._video_tasks.remove(t) if t in self._video_tasks else None)
            self._video_tasks.append(task)
    
    async def on_user_turn_completed(self, turn_ctx: ChatContext, new_message: ChatMessage) -> None:
        """Called when user completes a turn - add latest video frames to context"""
        from livekit.agents.llm import ImageContent
        
        if self._interview_mode == "mock-interview":
            user_content = ""
            if hasattr(new_message, 'content') and new_message.content:
                for content_item in new_message.content:
                    if hasattr(content_item, 'text'):
                        user_content += content_item.text + " "
                user_content = user_content.strip()
            
            if user_content:
                self._transcript.append({
                    "role": "user",
                    "content": user_content,
                    "timestamp": datetime.now().isoformat()
                })
        
        if self._interview_mode == "mock-interview":
            self._user_is_speaking = True
            self._last_question_time = None
            logger.info("User responded - silence timer reset")
        
        if self._latest_camera_frame:
            try:
                new_message.content.append(
                    ImageContent(image=self._latest_camera_frame)
                )
                logger.info("Added camera frame to chat context")
                self._latest_camera_frame = None
            except Exception as e:
                logger.warning(f"Could not add camera frame to context: {e}")
        
        if self._latest_screen_frame:
            try:
                new_message.content.append(
                    ImageContent(image=self._latest_screen_frame)
                )
                logger.info("Added screen share frame to chat context")
                self._latest_screen_frame = None
            except Exception as e:
                logger.warning(f"Could not add screen share frame to context: {e}")
    
    async def on_agent_turn_completed(self, turn_ctx: ChatContext) -> None:
        """Called when agent finishes speaking - update timestamp for silence detection"""
        if self._interview_mode == "mock-interview":
            import time
            self._last_question_time = time.time()
            logger.info("Agent finished speaking (on_agent_turn_completed), timestamp updated")
            
            try:
                messages = turn_ctx.messages
                if messages:
                    last_msg = messages[-1]
                    if hasattr(last_msg, 'content'):
                        agent_content = ""
                        if isinstance(last_msg.content, str):
                            agent_content = last_msg.content
                        elif isinstance(last_msg.content, list):
                            for item in last_msg.content:
                                if hasattr(item, 'text'):
                                    agent_content += item.text + " "
                            agent_content = agent_content.strip()
                        
                        if agent_content:
                            self._transcript.append({
                                "role": "assistant",
                                "content": agent_content,
                                "timestamp": datetime.now().isoformat()
                            })
            except Exception as e:
                logger.debug(f"Could not track agent message in transcript: {e}")


def prewarm(proc: JobProcess):
    """Prewarm the voice agent with necessary models and services."""
    global _GLOBAL_RAG_SERVICE
    
    logger.info("Starting prewarm process...")
    
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.45,
        activation_threshold=0.5,
    )
    logger.info("VAD model loaded")
    
    if _GLOBAL_RAG_SERVICE is None:
        _GLOBAL_RAG_SERVICE = RAGService()
        logger.info("RAG Service initialized")
    
    logger.info("Prewarm completed")


def _create_llm_instance():
    """Create LLM instance using AWS Bedrock"""
    return aws.LLM(
        model=Config.BEDROCK_MODEL_ID,
        region=Config.AWS_REGION,
        temperature=Config.TEMPERATURE,
    )


def _create_agent_session(ctx: JobContext, llm_instance, interview_mode: str = "practice"):
    """Create AgentSession with all required components"""
    turn_detector = MultilingualModel()
    
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
        turn_detection=turn_detector,
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
        return f"Hello {user_name}! I'm Nila, your AI interview practice partner. I'm here to help you prepare for your interview. To get the most out of our practice session, I'd recommend turning on your camera so I can help you with body language and presence. Also, if you'd like to practice coding, you can share your screen or use the Code Editor feature - just click 'Code Editor' in the sidebar! Let's begin!"
    else:
        return "Hello! I'm Nila, your AI interview practice partner. I'm here to help you prepare for your interview. To get the most out of our practice session, I'd recommend turning on your camera so I can help you with body language and presence. Also, if you'd like to practice coding, you can share your screen or use the Code Editor feature - just click 'Code Editor' in the sidebar! Let's begin!"


async def entrypoint(ctx: JobContext):
    """Main entrypoint for the voice agent"""
    global _GLOBAL_RAG_SERVICE
    
    ctx.log_context_fields = {"room": ctx.room.name}
    
    logger.info(f"Starting interview agent for room: {ctx.room.name}")
    logger.info("Agent name: Nila")
    
    await ctx.connect()
    
    room_name = ctx.room.name
    logger.info(f"Room name: {room_name}")
    
    user_name = await _extract_user_name(ctx)
    job_description = None
    user_name_for_rag = None
    
    metadata_dict = {}
    
    try:
        job_obj = getattr(ctx, 'job', None)
        if job_obj:
            metadata = getattr(job_obj, 'metadata', None)
            
            if metadata and str(metadata).strip() and str(metadata).strip().lower() != "none":
                if isinstance(metadata, str):
                    try:
                        metadata_dict = json.loads(metadata)
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse job metadata JSON: {e}, raw: {metadata[:100]}")
                elif isinstance(metadata, dict):
                    metadata_dict = metadata
    except Exception as e:
        logger.warning(f"Could not extract from job metadata: {e}")
    
    if not metadata_dict or not metadata_dict.get('job_description'):
        try:
            for participant in ctx.room.remote_participants.values():
                participant_meta = getattr(participant, 'metadata', None)
                if participant_meta:
                    try:
                        if isinstance(participant_meta, str):
                            part_meta_dict = json.loads(participant_meta)
                        else:
                            part_meta_dict = participant_meta
                        
                        if not metadata_dict:
                            metadata_dict = part_meta_dict
                        else:
                            metadata_dict.update({k: v for k, v in part_meta_dict.items() if k not in metadata_dict})
                        break
                    except Exception as e:
                        logger.debug(f"Could not parse participant metadata: {e}")
        except Exception as e:
            logger.debug(f"Could not extract from participant metadata: {e}")
    
    interview_mode = "practice"
    if metadata_dict:
        user_name_from_metadata = metadata_dict.get('user_name')
        job_description = metadata_dict.get('job_description')
        interview_mode = metadata_dict.get('mode', 'practice')
        
        user_name_for_rag = user_name_from_metadata or user_name
        
        if user_name_for_rag and _GLOBAL_RAG_SERVICE:
            _GLOBAL_RAG_SERVICE.set_user_context(user_name_for_rag, None)
            logger.info(f"Set RAG context for user_name: {user_name_for_rag}")
        
        if job_description and job_description.strip():
            logger.info(f"Job description provided (length: {len(job_description)} chars)")
        else:
            logger.warning(f"No job_description found in metadata or it's empty")
    else:
        logger.warning(f"No metadata found in job or participant metadata")
    
    if not user_name_for_rag and user_name and _GLOBAL_RAG_SERVICE:
        _GLOBAL_RAG_SERVICE.set_user_context(user_name, None)
        logger.info(f"Set RAG context using fallback user_name: {user_name}")
    
    if user_name:
        logger.info(f"User name: {user_name}")
    else:
        logger.info("User name: Not available")
    
    llm_instance = _create_llm_instance()
    session = _create_agent_session(ctx, llm_instance, interview_mode)
    
    initial_ctx = ChatContext()
    
    initial_ctx.add_message(
        role="system",
        content="Your name is Nila. Always refer to yourself as Nila. Never use any other name like Alex or any other name. When introducing yourself, always say 'I'm Nila' or 'I'm Nila, your AI interview practice partner'."
    )
    
    if user_name:
        initial_ctx.add_message(
            role="assistant",
            content=f"The candidate's name is {user_name}. Remember to use their name naturally throughout the interview."
        )
    
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
        logger.info(f"Job description added to prompt context (length: {len(job_description)} chars)")
    else:
        logger.warning("No job description available - agent will conduct general interview practice")
    
    if interview_mode == "mock-interview":
        initial_ctx.add_message(
            role="system",
            content="""VIDEO ANALYSIS IN INTERVIEW MODE:
- Camera, microphone, and screen share are REQUIRED - they should already be enabled
- Observe body language, posture, eye contact, and facial expressions for evaluation
- Analyze code when sent via IDE or screen share for technical assessment
- Provide minimal feedback during interview - focus on evaluation, not teaching
- Note observations silently for final evaluation - do NOT interrupt the interview flow with feedback
- Be professional and evaluative in your observations
- When reviewing code, be critical: "I see an issue here..." or "This approach has problems..."
- Do NOT provide coaching or suggestions - only evaluate"""
        )
    else:
        initial_ctx.add_message(
            role="system",
            content="""VIDEO ANALYSIS CAPABILITIES AND PROACTIVE GUIDANCE:
- PROACTIVELY suggest features to candidates:
  * Early in conversation: "I'd love to help you with your body language! Would you like to turn on your camera so I can give you real-time feedback?"
  * When discussing coding: "For coding practice, you can share your screen and I'll help analyze your code, or use the Code Editor feature - just click 'Code Editor' in the sidebar!"
  * If camera not enabled: "I notice you haven't enabled your camera yet - would you like to turn it on? I can provide real-time feedback on your body language!"
- If the candidate enables their camera, AUTOMATICALLY analyze their body language, posture, eye contact, and facial expressions
- When camera is enabled, acknowledge it: "Great! I can see you now. I'll provide real-time feedback on your body language throughout our conversation."
- If the candidate shares their screen, AUTOMATICALLY analyze their code and provide coding guidance
- When screen share is enabled, acknowledge it: "Perfect! I can see your screen now. I'll help analyze your code and provide real-time guidance as you work!"
- When code is sent via IDE, acknowledge it: "Great! I received your code. Let me analyze it and we can discuss it together!"
- When video is active, PROACTIVELY provide feedback during the conversation - don't wait to be asked
- Integrate video feedback naturally into your responses - weave it in organically
- Be encouraging and constructive - help them improve, not criticize
- Mention these capabilities naturally: "I can see you're [observation]. [Suggestion]."
- For coding: "I notice in your code [observation]. [Suggestion]. [Teaching point]."
- Remember: You're their teacher and coach - use video analysis to help them succeed!
- Be proactive in suggesting features - don't wait for them to ask!"""
        )
    logger.info(f"Video analysis capabilities added to prompt context (mode: {interview_mode})")
    
    if interview_mode == "mock-interview":
        initial_ctx.add_message(
            role="system",
            content="CRITICAL REQUIREMENTS FOR MOCK INTERVIEW:\n"
                   "1. Camera and screen sharing MUST be enabled before the interview can begin\n"
                   "2. DO NOT ask any interview questions until BOTH camera and screen sharing are confirmed active\n"
                   "3. If camera is missing, say: 'I need your camera to be enabled before we can proceed.'\n"
                   "4. If screen sharing is missing, say: 'I need you to share your screen before we can proceed.'\n"
                   "5. Wait and remind them until both are enabled\n"
                   "6. SILENCE HANDLING: If candidate doesn't respond within 5 seconds after you ask a question, prompt them immediately:\n"
                   "   - 'Are you still there? Please respond.'\n"
                   "   - 'Can you hear me? Please answer the question.'\n"
                   "   - 'I'm waiting for your response. Please proceed.'\n"
                   "7. Continue prompting every 5 seconds of silence until they respond\n"
                   "8. Do NOT move to next question if they haven't answered - keep prompting them to respond\n"
                   "9. SCREEN MONITORING: Continuously monitor the screen share content throughout the entire interview\n"
                   "10. CRITICAL: The candidate MUST remain on the interview application page at all times\n"
                   "11. If screen shows ANY content from OTHER APPLICATIONS, OTHER BROWSER TABS, or ANY PAGE OUTSIDE THE INTERVIEW APPLICATION:\n"
                   "    - First warning (immediately): 'I notice you've switched away from the interview application. Please return to the interview page immediately.'\n"
                   "    - Wait 10 seconds, if still not returned: 'You must stay on the interview application page. Please return now or the interview will be terminated.'\n"
                   "    - Wait another 10 seconds, if still not returned: 'I'm terminating this interview as you have left the interview application. Thank you for your time.'\n"
                   "12. Any navigation away from the interview app is grounds for immediate interview termination\n"
                   "13. This is a strict requirement - candidates must stay within the interview application at all times"
        )
    
    if user_name and _GLOBAL_RAG_SERVICE:
        if interview_mode == "mock-interview":
            initial_ctx.add_message(
                role="system",
                content="CRITICAL: You have access to the candidate's resume through the search_candidate_info tool. NEVER say 'let me search', 'let me check', 'I'll look up', 'let me review', or any similar phrases. Use the tool COMPLETELY SILENTLY. After using it, ask questions naturally as if you already knew the information. Only mention reviewing their resume ONCE at the very beginning: 'I've reviewed your resume. Let's begin.' After that, NEVER mention searching or checking the resume again."
            )
        else:
            initial_ctx.add_message(
                role="system",
                content="The candidate may have uploaded their resume. Use the search_candidate_info tool to access their background, skills, and experience for personalized questions. Use this tool autonomously when you need specific details from their resume."
            )
    
    rag_tool = None
    if _GLOBAL_RAG_SERVICE:
        rag_tool = _GLOBAL_RAG_SERVICE.get_rag_function_tool(is_mock_interview=(interview_mode == "mock-interview"))
        logger.info("RAG tool added to agent")
    
    if interview_mode == "mock-interview":
        prompt = MOCK_INTERVIEW_PROMPT
        logger.info("Using MOCK INTERVIEW mode - agent will act as real interviewer")
    else:
        prompt = INTERVIEW_CONDUCTOR_PROMPT
        logger.info("Using PRACTICE mode - agent will act as practice partner")
    
    assistant = InterviewAssistant(chat_ctx=initial_ctx, rag_tool=rag_tool, instructions=prompt, interview_mode=interview_mode)
    
    # Store session metadata in assistant for feedback generation
    session_id = metadata_dict.get('session_id') if metadata_dict else None
    assistant._session_id = session_id
    assistant._user_name = user_name_for_rag or user_name
    assistant._job_description = job_description
    
    # Store session reference in assistant for silence checks
    assistant._agent_session = session
    
    # Set up silence detection for mock interviews BEFORE starting session
    original_say = None  # Will be set in mock interview mode
    if interview_mode == "mock-interview":
        import time
        
        # Wrap session.say to track when agent speaks
        original_say = session.say
        
        async def say_with_tracking(text: str, **kwargs):
            """Wrap session.say to track when agent finishes speaking"""
            result = await original_say(text, **kwargs)
            
            # Skip tracking for the silence check message itself to avoid infinite loop
            if "Are you still there" in text or "Can you hear me" in text:
                return result
            
            # Track agent message in transcript
            assistant._transcript.append({
                "role": "assistant",
                "content": text,
                "timestamp": datetime.now().isoformat()
            })
            
            assistant._user_is_speaking = False
            assistant._last_question_time = time.time()
            logger.info(f"Agent finished speaking (via session.say): '{text[:50]}...' - timestamp updated")
            return result
        
        session.say = say_with_tracking
        logger.info("Session.say wrapper installed for silence detection")
    
    await session.start(
        agent=assistant,
        room=ctx.room,
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVC(),
        ),
    )
    
    logger.info("Interview session started")
    
    if interview_mode == "mock-interview":
        import time
        
        @session.on("metrics_collected")
        def on_metrics_collected(event):
            """Called when metrics are collected - check for TTS completion"""
            if isinstance(event.metrics, TTSMetrics):
                assistant._user_is_speaking = False
                assistant._last_question_time = time.time()
                logger.info(f"Agent finished speaking (via TTSMetrics completion), timestamp updated")
        
        logger.info("Session TTSMetrics handler registered for silence detection")
    
    if interview_mode == "mock-interview":
        import time
        
        async def monitor_silence_continuously():
            """Background task to continuously monitor for silence throughout the session"""
            while True:
                try:
                    await asyncio.sleep(1.0)
                    
                    if assistant._user_is_speaking:
                        continue
                    
                    try:
                        if not session.is_running:
                            logger.info("Session is not running, stopping silence monitoring")
                            break
                    except:
                        break
                    
                    if assistant._last_question_time and not assistant._is_checking_silence:
                        time_since_question = time.time() - assistant._last_question_time
                        
                        if time_since_question >= 5.0:
                            if assistant._user_is_speaking:
                                continue
                                
                            assistant._is_checking_silence = True
                            logger.info("5 seconds of silence detected - checking if candidate is available")
                            
                            try:
                                if not session.is_running:
                                    break
                                    
                                if original_say:
                                    await original_say("Are you still there? Can you hear me?")
                                else:
                                    await session.say("Are you still there? Can you hear me?")
                                assistant._last_question_time = time.time()
                                logger.info("Silence check message sent, continuing to monitor")
                            except Exception as e:
                                logger.warning(f"Error asking if candidate is available: {e}")
                                if "closing" in str(e).lower() or "isn't running" in str(e).lower():
                                    break
                            finally:
                                assistant._is_checking_silence = False
                                
                except asyncio.CancelledError:
                    logger.info("Silence monitoring task cancelled")
                    break
                except Exception as e:
                    logger.warning(f"Error in silence monitoring: {e}")
                    await asyncio.sleep(1.0)
        
        silence_monitor_task = asyncio.create_task(monitor_silence_continuously())
        logger.info("Continuous silence monitoring started for mock interview mode")
    
    SOURCE_CAMERA = 1
    SOURCE_SCREEN_SHARE = 3
    
    def check_and_subscribe_video_tracks():
        """Check for camera and screen share tracks from remote participants and subscribe"""
        has_camera = False
        has_screen_share = False
        
        for participant in ctx.room.remote_participants.values():
            for publication in participant.track_publications.values():
                if publication.kind == rtc.TrackKind.KIND_VIDEO:
                    source = publication.source
                    if not publication.subscribed:
                        try:
                            ctx.room.local_participant.set_subscribed(publication.sid, True)
                            logger.info(f"Subscribed to video track from {participant.identity}, source={source}")
                        except Exception as e:
                            logger.warning(f"Could not subscribe to video track: {e}")
                    else:
                        logger.info(f"Video track already subscribed from {participant.identity}, source={source}")
                    
                    if source == SOURCE_CAMERA:
                        has_camera = True
                        logger.info(f"Camera track detected from {participant.identity}")
                    elif source == SOURCE_SCREEN_SHARE:
                        has_screen_share = True
                        logger.info(f"Screen share track detected from {participant.identity}")
        
        return has_camera, has_screen_share
    
    has_camera, has_screen_share = check_and_subscribe_video_tracks()
    
    if has_camera or has_screen_share:
        if interview_mode == "mock-interview":
            video_context = "The candidate has "
            if has_camera:
                video_context += "enabled their camera"
            if has_camera and has_screen_share:
                video_context += " and "
            if has_screen_share:
                video_context += "started screen sharing"
            video_context += ". Observe and evaluate silently - do NOT provide feedback during the interview."
        else:
            video_context = "The candidate has "
            if has_camera:
                video_context += "enabled their camera"
            if has_camera and has_screen_share:
                video_context += " and "
            if has_screen_share:
                video_context += "started screen sharing"
            video_context += ". You can now see their video feed and provide real-time feedback."
        
        initial_ctx.add_message(
            role="system",
            content=video_context
        )
        logger.info(f"Video context updated: camera={has_camera}, screen_share={has_screen_share}")
    
    if interview_mode == "mock-interview":
        if not has_camera or not has_screen_share:
            missing_items = []
            if not has_camera:
                missing_items.append("camera")
            if not has_screen_share:
                missing_items.append("screen sharing")
            
            requirement_msg = f"Hello{' ' + user_name if user_name else ''}. I'm Nila, and I'll be conducting your interview today. "
            requirement_msg += f"Before we can proceed, I need you to enable your {' and '.join(missing_items)}. "
            requirement_msg += "The interview cannot begin until both your camera and screen sharing are active. Please enable them now."
            
            await session.say(requirement_msg)
            logger.info(f"Mock interview mode - requirements check: camera={has_camera}, screen_share={has_screen_share}")
            
            initial_ctx.add_message(
                role="system",
                content=f"CRITICAL: The candidate has NOT enabled {' and '.join(missing_items)} yet. DO NOT start the interview. Keep reminding them to enable camera and screen sharing until both are active. Only after confirming both are enabled, proceed with the interview."
            )
            
            assistant._transcript.append({
                "role": "assistant",
                "content": requirement_msg,
                "timestamp": datetime.now().isoformat()
            })
        else:
            if user_name:
                greeting = f"Hello {user_name}. I'm Nila, and I'll be conducting your interview today. I've reviewed your resume. Let's begin."
            else:
                greeting = "Hello. I'm Nila, and I'll be conducting your interview today. I've reviewed your resume. Let's begin."
            await session.say(greeting)
            logger.info("Mock interview mode - professional greeting sent (camera and screen share confirmed)")
            
            assistant._transcript.append({
                "role": "assistant",
                "content": greeting,
                "timestamp": datetime.now().isoformat()
            })
        
        feedback_generated = False
        
        async def generate_feedback_on_end():
            """Generate feedback when session ends"""
            nonlocal feedback_generated
            
            if feedback_generated:
                logger.info("Feedback already generated, skipping duplicate")
                return
            
            try:
                logger.info(f"Feedback generation triggered - session_id: {assistant._session_id}, transcript length: {len(assistant._transcript)}")
                if assistant._session_id and len(assistant._transcript) > 0:
                    feedback_generated = True
                    logger.info(f"Generating feedback for session: {assistant._session_id}")
                    
                    from services.feedback_service import FeedbackService
                    from models.feedback import FeedbackModel
                    from config.database import get_database
                    
                    feedback_service = FeedbackService()
                    feedback_data = await feedback_service.generate_feedback(
                        session_id=assistant._session_id,
                        user_name=assistant._user_name or "Candidate",
                        transcript=assistant._transcript,
                        job_description=assistant._job_description,
                        interview_mode=interview_mode
                    )
                    
                    try:
                        db = await get_database()
                        collection = db[FeedbackModel.COLLECTION_NAME]
                        FeedbackModel.create_indexes(collection)
                        await FeedbackModel.save_feedback(
                            collection=collection,
                            session_id=assistant._session_id,
                            user_name=assistant._user_name or "Candidate",
                            feedback_data=feedback_data,
                            job_description=assistant._job_description,
                            interview_mode=interview_mode
                        )
                        logger.info(f"Feedback saved to MongoDB for session: {assistant._session_id}")
                    except Exception as db_error:
                        logger.error(f"Failed to save feedback to MongoDB: {db_error}", exc_info=True)
                        feedback_generated = False
                    
                    try:
                        feedback_summary = feedback_data.get("sections", {}).get("Overall Performance Summary", "")
                        if feedback_summary:
                            summary_short = feedback_summary[:200] + "..." if len(feedback_summary) > 200 else feedback_summary
                            await session.say(f"Thank you for the interview. Here's a brief summary: {summary_short} Full detailed feedback has been saved and is available in the Analysis tab.")
                        else:
                            await session.say("Thank you for the interview. Your detailed feedback has been generated and saved. You can view it in the Analysis tab.")
                    except Exception as say_error:
                        logger.warning(f"Could not provide verbal feedback: {say_error}")
                    
            except Exception as e:
                logger.error(f"Error generating feedback: {e}", exc_info=True)
                feedback_generated = False
        
        async def on_shutdown():
            """Called when job context shuts down"""
            if interview_mode == "mock-interview":
                logger.info("Job context shutting down - triggering feedback generation")
                await generate_feedback_on_end()
        
        ctx.add_shutdown_callback(on_shutdown)
        logger.info("Feedback generation hook registered on job context shutdown")
        
        # Note: Removed room disconnect hook to prevent duplicate feedback generation
        # The shutdown callback is sufficient and more reliable
    else:
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

