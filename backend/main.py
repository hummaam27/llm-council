"""FastAPI backend for LLM Council."""

import logging
import sys

# Configure logging to show timestamps and be verbose
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(name)s | %(message)s',
    datefmt='%H:%M:%S',
    stream=sys.stdout
)
logger = logging.getLogger('council')
logger.setLevel(logging.DEBUG)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage1_collect_responses_streaming, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings
from .openrouter import fetch_available_models
from . import config
from .jobs import job_manager, JobStatus
from .debate import run_debate, DEBATE_ROLES

app = FastAPI(title="LLM Council API")

@app.on_event("startup")
async def startup_event():
    """Log startup information."""
    logger.info("=" * 60)
    logger.info("LLM COUNCIL API STARTING")
    logger.info("=" * 60)
    logger.info(f"API Key: {'✓ Loaded' if config.OPENROUTER_API_KEY else '✗ MISSING!'}")
    logger.info(f"Council Models: {config.get_council_models() or '(none configured)'}")
    logger.info(f"Chairman Model: {config.get_chairman_model() or '(none configured)'}")
    logger.info("=" * 60)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str


class UpdateCouncilConfigRequest(BaseModel):
    """Request to update council configuration."""
    council_models: List[str]
    chairman_model: str


class StartDebateRequest(BaseModel):
    """Request to start a debate."""
    topic: str
    models: List[str]
    max_turns: int = 6
    roles: Optional[List[str]] = None


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]
    pending_job: Optional[Dict[str, Any]] = None


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a running job."""
    cancelled = await job_manager.cancel_job(job_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Job not found or already completed")
    logger.info(f"Job {job_id[:8]} cancelled by user")
    return {"success": True, "job_id": job_id, "message": "Job cancelled"}


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages, including any pending job."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Check if there's an active job for this conversation
    job = await job_manager.get_job_for_conversation(conversation_id)
    if job and job["status"] not in [JobStatus.COMPLETE, JobStatus.ERROR]:
        conversation["pending_job"] = job
    else:
        conversation["pending_job"] = None
    
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation."""
    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True, "id": conversation_id}


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(request.content)
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result,
        metadata
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


JOB_TIMEOUT_SECONDS = 600  # 10 minute max for entire job

async def run_council_job(job_id: str, conversation_id: str, user_query: str, is_first_message: bool):
    """
    Run the council process as a background job.
    This runs independently of client connections.
    """
    logger.info(f"[Job {job_id[:8]}] Starting council job (timeout: {JOB_TIMEOUT_SECONDS}s)...")
    try:
        # Start title generation in parallel (don't await yet)
        title_task = None
        if is_first_message:
            logger.debug(f"[Job {job_id[:8]}] Starting title generation task")
            title_task = asyncio.create_task(generate_conversation_title(user_query))

        # Stage 1: Collect responses with streaming
        logger.info(f"[Job {job_id[:8]}] ▶ STAGE 1: Collecting individual responses (streaming)...")
        await job_manager.update_job_status(job_id, JobStatus.STAGE1_RUNNING)
        
        # Set up progress tracking
        models = config.get_council_models()
        await job_manager.update_job_progress(job_id, models_total=len(models))
        
        # Initialize model streams
        for model in models:
            await job_manager.update_model_stream(job_id, model, status='streaming')
        
        async def on_chunk(model: str, chunk: str):
            """Called for each chunk of text from a model."""
            await job_manager.update_model_stream(job_id, model, content_chunk=chunk)
        
        async def on_model_complete(model: str, success: bool):
            """Called when each model finishes."""
            if success:
                logger.info(f"[Job {job_id[:8]}] ✓ {model} complete")
                await job_manager.update_model_stream(job_id, model, status='complete')
                await job_manager.update_job_progress(job_id, model_responded=model)
            else:
                logger.warning(f"[Job {job_id[:8]}] ✗ {model} failed/timeout")
                await job_manager.update_model_stream(job_id, model, status='failed')
                await job_manager.update_job_progress(job_id, model_failed=model)
        
        stage1_results = await stage1_collect_responses_streaming(user_query, on_chunk, on_model_complete)
        logger.info(f"[Job {job_id[:8]}] ✓ STAGE 1 COMPLETE: Got {len(stage1_results)} responses")
        for r in stage1_results:
            logger.debug(f"  - {r['model']}: {len(r['response'])} chars")
        await job_manager.update_job_status(job_id, JobStatus.STAGE1_COMPLETE, stage1=stage1_results)

        # Stage 2: Collect rankings
        logger.info(f"[Job {job_id[:8]}] ▶ STAGE 2: Collecting peer rankings...")
        await job_manager.update_job_status(job_id, JobStatus.STAGE2_RUNNING)
        stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)
        aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
        logger.info(f"[Job {job_id[:8]}] ✓ STAGE 2 COMPLETE: Got {len(stage2_results)} rankings")
        metadata = {
            'label_to_model': label_to_model,
            'aggregate_rankings': aggregate_rankings
        }
        await job_manager.update_job_status(
            job_id, 
            JobStatus.STAGE2_COMPLETE, 
            stage2=stage2_results,
            metadata=metadata
        )

        # Stage 3: Synthesize final answer
        logger.info(f"[Job {job_id[:8]}] ▶ STAGE 3: Synthesizing final answer...")
        await job_manager.update_job_status(job_id, JobStatus.STAGE3_RUNNING)
        stage3_result = await stage3_synthesize_final(user_query, stage1_results, stage2_results)
        logger.info(f"[Job {job_id[:8]}] ✓ STAGE 3 COMPLETE: Final response from {stage3_result.get('model', 'unknown')}")
        await job_manager.update_job_status(job_id, JobStatus.COMPLETE, stage3=stage3_result)

        # Wait for title generation if it was started
        if title_task:
            title = await title_task
            logger.debug(f"[Job {job_id[:8]}] Title generated: {title}")
            storage.update_conversation_title(conversation_id, title)

        # Save complete assistant message to storage
        storage.add_assistant_message(
            conversation_id,
            stage1_results,
            stage2_results,
            stage3_result,
            metadata
        )

        # Mark job as complete
        await job_manager.complete_job(job_id)
        logger.info(f"[Job {job_id[:8]}] ✓✓✓ JOB COMPLETE ✓✓✓")

    except Exception as e:
        logger.error(f"[Job {job_id[:8]}] ✗ JOB FAILED: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        await job_manager.fail_job(job_id, str(e))


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    """
    Send a message and start the council process as a background job.
    Returns the job ID immediately, then streams status updates.
    The job continues running even if the client disconnects.
    """
    logger.info(f"=" * 60)
    logger.info(f"NEW MESSAGE REQUEST for conversation {conversation_id[:8]}...")
    logger.info(f"User query: {request.content[:100]}{'...' if len(request.content) > 100 else ''}")
    
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        logger.error(f"Conversation {conversation_id} not found!")
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if there's already a running job for this conversation
    if await job_manager.is_job_running(conversation_id):
        logger.warning(f"Job already running for conversation {conversation_id[:8]}")
        raise HTTPException(status_code=409, detail="A council process is already running for this conversation")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message immediately
    storage.add_user_message(conversation_id, request.content)

    # Create a job
    job_id = await job_manager.create_job(conversation_id, request.content)
    logger.info(f"Created job {job_id[:8]}... for conversation {conversation_id[:8]}...")

    # Start the council process as a background task
    logger.info(f"Starting council background task...")
    task = asyncio.create_task(
        run_council_job(job_id, conversation_id, request.content, is_first_message)
    )
    await job_manager.set_job_task(job_id, task)
    logger.info(f"Background task started successfully")

    async def event_generator():
        """
        Stream job status updates to the client.
        The job runs independently - this just reports progress.
        """
        logger.info(f"[Stream {job_id[:8]}] Event generator started")
        last_status = None
        poll_count = 0
        
        try:
            # Send initial job info
            logger.info(f"[Stream {job_id[:8]}] Sending job_started event")
            yield f"data: {json.dumps({'type': 'job_started', 'job_id': job_id})}\n\n"
            
            while True:
                poll_count += 1
                job = await job_manager.get_job(job_id)
                if not job:
                    logger.error(f"[Stream {job_id[:8]}] Job not found after {poll_count} polls!")
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Job not found'})}\n\n"
                    break
                
                current_status = job["status"]
                
                # Log every 50 polls to show we're still alive
                if poll_count % 50 == 0:
                    logger.debug(f"[Stream {job_id[:8]}] Poll #{poll_count}, status: {current_status}")
                
                # Send progress updates during stage1 (every poll)
                if current_status == JobStatus.STAGE1_RUNNING:
                    progress = job.get("progress", {})
                    yield f"data: {json.dumps({'type': 'stage1_progress', 'progress': progress})}\n\n"
                
                # Send status change events
                if current_status != last_status:
                    logger.info(f"[Stream {job_id[:8]}] Status changed: {last_status} -> {current_status}")
                    last_status = current_status
                    
                    if current_status == JobStatus.STAGE1_RUNNING:
                        yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
                    
                    elif current_status == JobStatus.STAGE1_COMPLETE:
                        logger.info(f"[Stream {job_id[:8]}] Sending stage1_complete with {len(job['stage1'])} responses")
                        yield f"data: {json.dumps({'type': 'stage1_complete', 'data': job['stage1']})}\n\n"
                    
                    elif current_status == JobStatus.STAGE2_RUNNING:
                        yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
                    
                    elif current_status == JobStatus.STAGE2_COMPLETE:
                        logger.info(f"[Stream {job_id[:8]}] Sending stage2_complete with {len(job['stage2'])} rankings")
                        yield f"data: {json.dumps({'type': 'stage2_complete', 'data': job['stage2'], 'metadata': job['metadata']})}\n\n"
                    
                    elif current_status == JobStatus.STAGE3_RUNNING:
                        yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
                    
                    elif current_status == JobStatus.COMPLETE:
                        logger.info(f"[Stream {job_id[:8]}] Sending stage3_complete and complete events")
                        yield f"data: {json.dumps({'type': 'stage3_complete', 'data': job['stage3']})}\n\n"
                        yield f"data: {json.dumps({'type': 'complete'})}\n\n"
                        break
                    
                    elif current_status == JobStatus.ERROR:
                        logger.error(f"[Stream {job_id[:8]}] Job error: {job['error']}")
                        yield f"data: {json.dumps({'type': 'error', 'message': job['error']})}\n\n"
                        break
                
                # Poll every 100ms
                await asyncio.sleep(0.1)
        except Exception as e:
            logger.error(f"[Stream {job_id[:8]}] Generator exception: {e}")
            import traceback
            logger.error(traceback.format_exc())
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            logger.info(f"[Stream {job_id[:8]}] Event generator finished after {poll_count} polls")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.get("/api/conversations/{conversation_id}/job")
async def get_conversation_job(conversation_id: str):
    """
    Get the current job status for a conversation.
    Used by the frontend to restore state after page refresh.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    job = await job_manager.get_job_for_conversation(conversation_id)
    if not job:
        return {"has_job": False}
    
    return {
        "has_job": True,
        "job": job
    }


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    """
    Get job status by job ID.
    """
    job = await job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/openrouter/models")
async def get_openrouter_models():
    """
    Fetch available models from OpenRouter API.
    Filters for OpenAI, Anthropic, and Google models only.
    """
    all_models = await fetch_available_models()
    
    # Filter for OpenAI, Anthropic, and Google models - chat/text only
    filtered_models = []
    for model in all_models:
        model_id = model.get('id', '')
        if model_id.startswith(('openai/', 'anthropic/', 'google/')):
            # Skip non-chat models (image, audio, embedding, moderation, tts, whisper)
            model_id_lower = model_id.lower()
            if any(skip in model_id_lower for skip in [
                'dall-e', 'image', 'vision', 'audio', 'whisper', 'tts', 
                'embedding', 'embed', 'moderation', 'realtime'
            ]):
                continue
            
            # Extract provider from model ID
            provider = model_id.split('/')[0]
            filtered_models.append({
                'id': model_id,
                'name': model.get('name', model_id),
                'provider': provider,
                'context_length': model.get('context_length', 0),
                'pricing': model.get('pricing', {}),
                'description': model.get('description', '')
            })
    
    return {'models': filtered_models}


@app.get("/api/council/config")
async def get_council_config():
    """Get current council configuration."""
    return {
        'council_models': config.get_council_models(),
        'chairman_model': config.get_chairman_model()
    }


@app.post("/api/council/config")
async def update_council_config(request: UpdateCouncilConfigRequest):
    """Update council configuration."""
    # Validate that models are provided
    if not request.council_models or len(request.council_models) == 0:
        raise HTTPException(status_code=400, detail="At least one council model is required")
    
    if not request.chairman_model:
        raise HTTPException(status_code=400, detail="Chairman model is required")
    
    # Save to persistent storage
    config.save_council_config(request.council_models, request.chairman_model)
    
    # Also update the module-level variables for backward compatibility
    config.COUNCIL_MODELS = request.council_models
    config.CHAIRMAN_MODEL = request.chairman_model
    
    return {
        'council_models': request.council_models,
        'chairman_model': request.chairman_model
    }


@app.get("/api/debate/roles")
async def get_debate_roles():
    """Get available debate roles."""
    return {
        'roles': [
            {'key': key, **value}
            for key, value in DEBATE_ROLES.items()
        ]
    }


@app.post("/api/debate/start")
async def start_debate(request: StartDebateRequest):
    """
    Start a debate and stream events as it progresses.
    Returns a streaming response with debate events.
    """
    # Validate request
    if not request.topic or not request.topic.strip():
        raise HTTPException(status_code=400, detail="Topic is required")
    
    if not request.models or len(request.models) < 2:
        raise HTTPException(status_code=400, detail="At least 2 models are required for a debate")
    
    if request.max_turns < 1:
        raise HTTPException(status_code=400, detail="max_turns must be at least 1")
    
    if request.max_turns > 20:
        raise HTTPException(status_code=400, detail="max_turns cannot exceed 20")

    async def event_generator():
        """Stream debate events to the client."""
        try:
            async for event in run_debate(
                topic=request.topic,
                debate_models=request.models,
                moderator_model=config.CHAIRMAN_MODEL,
                max_turns=request.max_turns,
                roles=request.roles
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
