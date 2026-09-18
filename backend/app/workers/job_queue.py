"""Minimal in-process background job system.

For a real deployment this would be Celery/RQ + Redis or similar. Given the
scope/time constraints here, jobs run on a background asyncio task pool within
the same process, but go through the SAME BackgroundJob row lifecycle
(queued -> running -> succeeded/failed) a real queue would use, so the
Admin "background job panel" and retry/idempotency semantics are real.
Documented as a simplification in ARCHITECTURE.md.
"""

import asyncio
import traceback
from datetime import datetime, timezone
from typing import Awaitable, Callable

from app.database import SessionLocal
from app.models.models import BackgroundJob

JobHandler = Callable[[dict], Awaitable[None]]

_handlers: dict[str, JobHandler] = {}


def register_handler(job_type: str):
    def decorator(fn: JobHandler):
        _handlers[job_type] = fn
        return fn

    return decorator


def enqueue_job(
    job_type: str,
    payload: dict,
    project_id: str | None = None,
    owner_id: str | None = None,
    idempotency_key: str | None = None,
) -> str:
    db = SessionLocal()
    try:
        if idempotency_key:
            existing = (
                db.query(BackgroundJob)
                .filter(BackgroundJob.idempotency_key == idempotency_key)
                .first()
            )
            if existing:
                return existing.id

        job = BackgroundJob(
            job_type=job_type,
            project_id=project_id,
            owner_id=owner_id,
            payload=payload,
            idempotency_key=idempotency_key,
            status="queued",
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        job_id = job.id
    finally:
        db.close()

    asyncio.create_task(_run_job(job_id))
    return job_id


async def _run_job(job_id: str, max_attempts: int = 3):
    db = SessionLocal()
    try:
        job = db.query(BackgroundJob).filter(BackgroundJob.id == job_id).first()
        if not job or job.status == "succeeded":
            return
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.attempts += 1
        db.commit()
        job_type = job.job_type
        payload = dict(job.payload or {})
    finally:
        db.close()

    handler = _handlers.get(job_type)
    error_message = None
    try:
        if handler is None:
            raise RuntimeError(f"No handler registered for job type '{job_type}'")
        await handler(payload)
        status = "succeeded"
    except Exception as exc:  # noqa: BLE001 - job failures must be captured, not raised
        status = "failed"
        error_message = f"{exc}\n{traceback.format_exc()}"

    db = SessionLocal()
    try:
        job = db.query(BackgroundJob).filter(BackgroundJob.id == job_id).first()
        if not job:
            return
        if status == "failed" and job.attempts < max_attempts:
            job.status = "queued"
            job.error_message = error_message
            db.commit()
            asyncio.create_task(_run_job(job_id, max_attempts))
            return
        job.status = status
        job.error_message = error_message
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
