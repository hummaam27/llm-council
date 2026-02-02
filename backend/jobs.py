"""Job manager for tracking council processes that run independently of client connections."""

import asyncio
import json
import os
from datetime import datetime
from typing import Dict, Any, Optional, List
from enum import Enum
import uuid

# Jobs are persisted to this file
JOBS_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs.json')


class JobStatus(str, Enum):
    PENDING = "pending"
    STAGE1_RUNNING = "stage1_running"
    STAGE1_COMPLETE = "stage1_complete"
    STAGE2_RUNNING = "stage2_running"
    STAGE2_COMPLETE = "stage2_complete"
    STAGE3_RUNNING = "stage3_running"
    COMPLETE = "complete"
    ERROR = "error"


class JobManager:
    """
    Manages council jobs that run independently of client connections.
    Jobs persist to disk so they survive server restarts.
    """
    
    def __init__(self):
        # job_id -> job data
        self._jobs: Dict[str, Dict[str, Any]] = {}
        # conversation_id -> job_id (for active jobs only)
        self._conversation_jobs: Dict[str, str] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()
        # Models that should be skipped (job_id -> set of model names)
        self._skipped_models: Dict[str, set] = {}
        # Flag to force continue to stage 2 (job_id -> bool)
        self._force_continue: Dict[str, bool] = {}
        # Load persisted jobs on startup
        self._load_jobs()
    
    def _load_jobs(self):
        """Load jobs from disk on startup."""
        try:
            if os.path.exists(JOBS_FILE):
                with open(JOBS_FILE, 'r') as f:
                    data = json.load(f)
                    self._jobs = data.get('jobs', {})
                    self._conversation_jobs = data.get('conversation_jobs', {})
                    print(f"[JobManager] Loaded {len(self._jobs)} jobs from disk")
        except Exception as e:
            print(f"[JobManager] Failed to load jobs: {e}")
            self._jobs = {}
            self._conversation_jobs = {}
    
    def _save_jobs(self):
        """Save jobs to disk."""
        try:
            # Ensure data directory exists
            os.makedirs(os.path.dirname(JOBS_FILE), exist_ok=True)
            
            # Don't save task objects - they can't be serialized
            jobs_to_save = {}
            for job_id, job in self._jobs.items():
                jobs_to_save[job_id] = {k: v for k, v in job.items() if k != 'task'}
            
            with open(JOBS_FILE, 'w') as f:
                json.dump({
                    'jobs': jobs_to_save,
                    'conversation_jobs': self._conversation_jobs
                }, f, indent=2)
        except Exception as e:
            print(f"[JobManager] Failed to save jobs: {e}")
    
    async def create_job(self, conversation_id: str, user_query: str) -> str:
        """
        Create a new job for a conversation.
        
        Args:
            conversation_id: The conversation this job belongs to
            user_query: The user's question
            
        Returns:
            The job ID
        """
        async with self._lock:
            job_id = str(uuid.uuid4())
            
            self._jobs[job_id] = {
                "id": job_id,
                "conversation_id": conversation_id,
                "user_query": user_query,
                "status": JobStatus.PENDING,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat(),
                "stage1": None,
                "stage2": None,
                "stage3": None,
                "metadata": None,
                "error": None,
                "task": None,  # Will hold the asyncio task
                "progress": {  # Real-time progress tracking
                    "models_total": 0,
                    "models_responded": [],
                    "models_pending": [],
                    "models_failed": [],
                    "model_streams": {},  # model -> {content: str, status: 'streaming'|'complete'|'failed'}
                    "stage2_streams": {},  # model -> {content: str, status: 'streaming'|'complete'|'failed', char_count: int}
                    "stage3_stream": {"content": "", "status": "pending", "char_count": 0, "model": ""},  # chairman streaming
                },
            }
            
            self._conversation_jobs[conversation_id] = job_id
            
            self._save_jobs()
            return job_id
    
    async def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job data by job ID."""
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                # Return a copy without the task object
                return {k: v for k, v in job.items() if k != "task"}
            return None
    
    async def get_job_for_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Get the active job for a conversation, if any."""
        async with self._lock:
            job_id = self._conversation_jobs.get(conversation_id)
            if job_id:
                job = self._jobs.get(job_id)
                if job:
                    return {k: v for k, v in job.items() if k != "task"}
            return None
    
    async def update_job_status(
        self,
        job_id: str,
        status: JobStatus,
        stage1: Optional[List] = None,
        stage2: Optional[List] = None,
        stage3: Optional[Dict] = None,
        metadata: Optional[Dict] = None,
        error: Optional[str] = None
    ):
        """Update job status and data."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            job["status"] = status
            job["updated_at"] = datetime.utcnow().isoformat()
            
            if stage1 is not None:
                job["stage1"] = stage1
            if stage2 is not None:
                job["stage2"] = stage2
            if stage3 is not None:
                job["stage3"] = stage3
            if metadata is not None:
                job["metadata"] = metadata
            if error is not None:
                job["error"] = error
            
            self._save_jobs()
    
    async def set_job_task(self, job_id: str, task: asyncio.Task):
        """Associate an asyncio task with a job."""
        async with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["task"] = task
    
    async def update_job_progress(
        self,
        job_id: str,
        models_total: int = None,
        model_responded: str = None,
        model_failed: str = None,
    ):
        """Update job progress - which models have responded."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            progress = job["progress"]
            
            if models_total is not None:
                progress["models_total"] = models_total
                # Initialize pending list with all models
                progress["models_pending"] = []
            
            if model_responded:
                if model_responded not in progress["models_responded"]:
                    progress["models_responded"].append(model_responded)
                if model_responded in progress["models_pending"]:
                    progress["models_pending"].remove(model_responded)
            
            if model_failed:
                if model_failed not in progress["models_failed"]:
                    progress["models_failed"].append(model_failed)
                if model_failed in progress["models_pending"]:
                    progress["models_pending"].remove(model_failed)
            
            job["updated_at"] = datetime.utcnow().isoformat()
            self._save_jobs()
    
    async def update_model_stream(
        self,
        job_id: str,
        model: str,
        content_chunk: str = None,
        status: str = None,  # 'streaming', 'complete', 'failed'
    ):
        """Update streaming content for a specific model (Stage 1)."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            streams = job["progress"]["model_streams"]
            
            if model not in streams:
                streams[model] = {"content": "", "status": "streaming", "char_count": 0}
            
            if content_chunk:
                streams[model]["content"] += content_chunk
                streams[model]["char_count"] = len(streams[model]["content"])
            
            if status:
                streams[model]["status"] = status
            
            # Don't save on every chunk - too expensive
            # Only save on status changes
            if status:
                self._save_jobs()
    
    async def update_stage2_stream(
        self,
        job_id: str,
        model: str,
        content_chunk: str = None,
        status: str = None,  # 'streaming', 'complete', 'failed'
    ):
        """Update streaming content for a specific model during Stage 2 (rankings)."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            streams = job["progress"]["stage2_streams"]
            
            if model not in streams:
                streams[model] = {"content": "", "status": "streaming", "char_count": 0}
            
            if content_chunk:
                streams[model]["content"] += content_chunk
                streams[model]["char_count"] = len(streams[model]["content"])
            
            if status:
                streams[model]["status"] = status
            
            # Only save on status changes
            if status:
                self._save_jobs()
    
    async def update_stage3_stream(
        self,
        job_id: str,
        model: str = None,
        content_chunk: str = None,
        status: str = None,  # 'streaming', 'complete', 'failed'
    ):
        """Update streaming content for Stage 3 (chairman synthesis)."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            stream = job["progress"]["stage3_stream"]
            
            if model:
                stream["model"] = model
            
            if content_chunk:
                stream["content"] += content_chunk
                stream["char_count"] = len(stream["content"])
            
            if status:
                stream["status"] = status
            
            # Only save on status changes
            if status:
                self._save_jobs()
    
    async def complete_job(self, job_id: str):
        """Mark a job as complete and clean up."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            conversation_id = job["conversation_id"]
            
            # Remove from active conversation jobs
            if self._conversation_jobs.get(conversation_id) == job_id:
                del self._conversation_jobs[conversation_id]
            
            # Keep job data for a while (could add TTL cleanup later)
            job["task"] = None
            
            self._save_jobs()
    
    async def fail_job(self, job_id: str, error: str):
        """Mark a job as failed."""
        async with self._lock:
            if job_id not in self._jobs:
                return
            
            job = self._jobs[job_id]
            job["status"] = JobStatus.ERROR
            job["error"] = error
            job["updated_at"] = datetime.utcnow().isoformat()
            
            conversation_id = job["conversation_id"]
            if self._conversation_jobs.get(conversation_id) == job_id:
                del self._conversation_jobs[conversation_id]
            
            job["task"] = None
            
            self._save_jobs()
    
    async def is_job_running(self, conversation_id: str) -> bool:
        """Check if there's an active job for a conversation."""
        async with self._lock:
            job_id = self._conversation_jobs.get(conversation_id)
            if not job_id:
                return False
            
            job = self._jobs.get(job_id)
            if not job:
                return False
            
            return job["status"] not in [JobStatus.COMPLETE, JobStatus.ERROR]
    
    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a running job."""
        async with self._lock:
            if job_id not in self._jobs:
                return False
            
            job = self._jobs[job_id]
            
            # Only cancel if still running
            if job["status"] in [JobStatus.COMPLETE, JobStatus.ERROR]:
                return False
            
            # Cancel the asyncio task if it exists
            task = job.get("task")
            if task and not task.done():
                task.cancel()
            
            job["status"] = JobStatus.ERROR
            job["error"] = "Job cancelled by user"
            job["updated_at"] = datetime.utcnow().isoformat()
            
            conversation_id = job["conversation_id"]
            if self._conversation_jobs.get(conversation_id) == job_id:
                del self._conversation_jobs[conversation_id]
            
            job["task"] = None
            
            self._save_jobs()
            return True
    
    async def cleanup_old_jobs(self, max_age_hours: int = 24):
        """Remove completed/failed jobs older than max_age_hours."""
        async with self._lock:
            now = datetime.utcnow()
            to_remove = []
            
            for job_id, job in self._jobs.items():
                if job["status"] in [JobStatus.COMPLETE, JobStatus.ERROR]:
                    created = datetime.fromisoformat(job["created_at"])
                    age_hours = (now - created).total_seconds() / 3600
                    if age_hours > max_age_hours:
                        to_remove.append(job_id)
            
            for job_id in to_remove:
                del self._jobs[job_id]
            
            if to_remove:
                self._save_jobs()

    async def skip_model(self, job_id: str, model: str) -> bool:
        """
        Mark a model as skipped for a job.
        Returns True if successful, False if job not found or not in stage1.
        """
        async with self._lock:
            if job_id not in self._jobs:
                return False
            
            job = self._jobs[job_id]
            if job["status"] not in [JobStatus.STAGE1_RUNNING, JobStatus.PENDING]:
                return False
            
            # Add to skipped models set
            if job_id not in self._skipped_models:
                self._skipped_models[job_id] = set()
            self._skipped_models[job_id].add(model)
            
            # Update model stream status to 'skipped'
            streams = job["progress"]["model_streams"]
            if model in streams:
                streams[model]["status"] = "skipped"
            
            # Add to failed list for tracking
            if model not in job["progress"]["models_failed"]:
                job["progress"]["models_failed"].append(model)
            
            job["updated_at"] = datetime.utcnow().isoformat()
            self._save_jobs()
            return True

    def is_model_skipped(self, job_id: str, model: str) -> bool:
        """Check if a model has been skipped. Thread-safe read."""
        # Note: This is a simple read operation. The dict.get() is atomic in CPython
        # and we're only reading, so this is safe without explicit locking.
        skipped = self._skipped_models.get(job_id)
        if skipped is None:
            return False
        return model in skipped

    async def force_continue_to_stage2(self, job_id: str, min_required: int = 1) -> bool:
        """
        Force the job to continue to stage 2 with whatever responses are available.
        
        Args:
            job_id: The job ID
            min_required: Minimum number of completed responses required (default 1)
            
        Returns:
            True if successful, False if job not found, not in stage1, or insufficient responses
        """
        async with self._lock:
            if job_id not in self._jobs:
                return False
            
            job = self._jobs[job_id]
            if job["status"] != JobStatus.STAGE1_RUNNING:
                return False
            
            # Check we have at least the minimum required completed responses
            completed = len(job["progress"]["models_responded"])
            if completed < min_required:
                return False
            
            self._force_continue[job_id] = True
            job["updated_at"] = datetime.utcnow().isoformat()
            self._save_jobs()
            return True

    def should_force_continue(self, job_id: str) -> bool:
        """Check if the job should force continue to stage 2. Thread-safe read."""
        # Note: This is a simple read operation. The dict.get() is atomic in CPython.
        return self._force_continue.get(job_id, False)

    def get_completed_count(self, job_id: str) -> int:
        """Get the number of completed model responses for a job."""
        if job_id not in self._jobs:
            return 0
        return len(self._jobs[job_id]["progress"]["models_responded"])

    async def cleanup_job_state(self, job_id: str):
        """Clean up temporary state for a job (called when job completes)."""
        async with self._lock:
            if job_id in self._skipped_models:
                del self._skipped_models[job_id]
            if job_id in self._force_continue:
                del self._force_continue[job_id]


# Global job manager instance
job_manager = JobManager()
