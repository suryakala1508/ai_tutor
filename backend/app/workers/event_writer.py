"""Idempotent writes to learning_events. event_id is the idempotency key —
duplicate writes (retries, duplicate job runs) are no-ops."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import LearningEvent


def write_learning_event(
    db: Session,
    project_id: str,
    owner_id: str,
    event_type: str,
    payload: dict,
    event_id: str,
) -> LearningEvent | None:
    existing = db.query(LearningEvent).filter(LearningEvent.event_id == event_id).first()
    if existing:
        return existing

    event = LearningEvent(
        event_id=event_id,
        project_id=project_id,
        owner_id=owner_id,
        type=event_type,
        payload=payload,
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return db.query(LearningEvent).filter(LearningEvent.event_id == event_id).first()
    db.refresh(event)
    return event
