import asyncio

import pytest

from app.models.models import BackgroundJob, LearningEvent, Project, Space, User
from app.workers import job_queue
from app.workers.event_writer import write_learning_event


def _make_user_space_project(db, email="j@test.com"):
    user = User(email=email, hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    space = Space(owner_id=user.id, name="S")
    db.add(space)
    db.commit()
    db.refresh(space)
    project = Project(space_id=space.id, owner_id=user.id, name="P")
    db.add(project)
    db.commit()
    db.refresh(project)
    return user, project


@pytest.mark.asyncio
async def test_successful_job_updates_state_to_succeeded(db_session):
    user, project = _make_user_space_project(db_session, "j1@test.com")

    calls = []

    @job_queue.register_handler("test_success_job")
    async def _handler(payload):
        calls.append(payload)

    job_id = job_queue.enqueue_job("test_success_job", {"x": 1}, project_id=project.id, owner_id=user.id)
    await asyncio.sleep(0.2)

    job = db_session.query(BackgroundJob).filter(BackgroundJob.id == job_id).first()
    assert job.status == "succeeded"
    assert job.finished_at is not None
    assert calls == [{"x": 1}]


@pytest.mark.asyncio
async def test_forced_failure_lands_in_failed_with_message(db_session):
    user, project = _make_user_space_project(db_session, "j2@test.com")

    @job_queue.register_handler("test_failing_job")
    async def _handler(payload):
        raise RuntimeError("simulated failure")

    job_id = job_queue.enqueue_job(
        "test_failing_job", {}, project_id=project.id, owner_id=user.id, idempotency_key="fail-once"
    )
    # allow all retry attempts (max_attempts=3) to run
    await asyncio.sleep(0.5)

    job = db_session.query(BackgroundJob).filter(BackgroundJob.id == job_id).first()
    assert job.status == "failed"
    assert job.error_message is not None
    assert "simulated failure" in job.error_message
    assert job.attempts == 3  # not silently lost — attempted and recorded


@pytest.mark.asyncio
async def test_duplicate_job_with_same_idempotency_key_does_not_double_enqueue(db_session):
    user, project = _make_user_space_project(db_session, "j3@test.com")

    @job_queue.register_handler("test_idempotent_job")
    async def _handler(payload):
        pass

    job_id_1 = job_queue.enqueue_job(
        "test_idempotent_job", {}, project_id=project.id, owner_id=user.id, idempotency_key="same-key"
    )
    job_id_2 = job_queue.enqueue_job(
        "test_idempotent_job", {}, project_id=project.id, owner_id=user.id, idempotency_key="same-key"
    )
    await asyncio.sleep(0.2)

    assert job_id_1 == job_id_2
    count = db_session.query(BackgroundJob).filter(BackgroundJob.idempotency_key == "same-key").count()
    assert count == 1


def test_learning_event_write_is_idempotent_by_event_id(db_session):
    user, project = _make_user_space_project(db_session, "j4@test.com")

    write_learning_event(
        db_session, project_id=project.id, owner_id=user.id, event_type="quiz_answered", payload={"a": 1}, event_id="ev-1"
    )
    write_learning_event(
        db_session, project_id=project.id, owner_id=user.id, event_type="quiz_answered", payload={"a": 2}, event_id="ev-1"
    )

    count = db_session.query(LearningEvent).filter(LearningEvent.event_id == "ev-1").count()
    assert count == 1
    # first write wins; retried/duplicate write does not overwrite payload
    row = db_session.query(LearningEvent).filter(LearningEvent.event_id == "ev-1").first()
    assert row.payload == {"a": 1}
