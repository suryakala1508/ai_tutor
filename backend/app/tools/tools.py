"""Structured, validated tool layer for the AI.

Every tool:
  1. Validates input against a pydantic schema (malformed AI output is rejected,
     never persisted).
  2. Runs get_owned_project() — the SAME authorization check normal API routes
     use — so the AI can never act outside the current user's Project scope.
  3. Returns a structured (dict) result and logs the call to ai_usage_events
     (tool_name, tool_input, outcome, latency).

The Tutor and quiz generator call these functions instead of touching
retrieveContext()/the DB directly, so there is one enforced path between
"AI decides it needs something" and "data is actually touched."
"""

import time
import uuid
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.authorization import AuthorizationError, get_owned_project
from app.models.models import (
    Concept,
    ConceptMastery,
    QuizAnswer,
    QuizQuestion,
)
from app.schemas.schemas import (
    GenerateQuizQuestionInput,
    GetMasteryInput,
    GetRecentMistakesInput,
    RecordLearningEventInput,
    SearchMaterialsInput,
)
from app.services.llm_client import log_ai_usage
from app.services.retrieval import retrieve_context
from app.workers.event_writer import write_learning_event


class ToolError(Exception):
    def __init__(self, message: str, outcome: str = "error"):
        super().__init__(message)
        self.outcome = outcome


def _log(db: Session, tool_name: str, tool_input: dict, outcome: str, latency_ms: int,
         project_id: str | None, owner_id: str | None, error_message: str | None = None) -> None:
    log_ai_usage(
        db,
        feature="tool_call",
        tool_name=tool_name,
        tool_input=tool_input,
        tool_outcome=outcome,
        latency_ms=latency_ms,
        success=(outcome == "success"),
        error_message=error_message,
        project_id=project_id,
        owner_id=owner_id,
    )


def _run_tool(db: Session, tool_name: str, raw_input: dict, owner_id: str, fn):
    start = time.monotonic()
    project_id = raw_input.get("project_id")
    try:
        result = fn()
        latency_ms = int((time.monotonic() - start) * 1000)
        _log(db, tool_name, raw_input, "success", latency_ms, project_id, owner_id)
        return result
    except ValidationError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        _log(db, tool_name, raw_input, "rejected_invalid", latency_ms, project_id, owner_id, str(exc))
        raise ToolError(f"Invalid input for {tool_name}: {exc}", outcome="rejected_invalid")
    except AuthorizationError as exc:
        latency_ms = int((time.monotonic() - start) * 1000)
        _log(db, tool_name, raw_input, "unauthorized", latency_ms, project_id, owner_id, str(exc))
        raise ToolError(f"Not authorized: {exc}", outcome="unauthorized")
    except Exception as exc:  # noqa: BLE001
        latency_ms = int((time.monotonic() - start) * 1000)
        _log(db, tool_name, raw_input, "error", latency_ms, project_id, owner_id, str(exc))
        raise ToolError(str(exc), outcome="error")


def search_materials(db: Session, owner_id: str, project_id: str, query: str) -> dict:
    raw = {"project_id": project_id, "query": query}

    def _impl():
        parsed = SearchMaterialsInput.model_validate(raw)
        get_owned_project(db, parsed.project_id, owner_id, raise_http=False)
        chunks, insufficient = retrieve_context(db, parsed.project_id, parsed.query)
        return {
            "insufficient_evidence": insufficient,
            "results": [
                {
                    "chunk_id": c.chunk_id,
                    "material_name": c.material_name,
                    "page_number": c.page_number,
                    "text": c.text,
                    "score": round(c.score, 4),
                }
                for c in chunks
            ],
        }

    return _run_tool(db, "search_materials", raw, owner_id, _impl)


def get_mastery(db: Session, owner_id: str, project_id: str) -> dict:
    raw = {"project_id": project_id}

    def _impl():
        parsed = GetMasteryInput.model_validate(raw)
        get_owned_project(db, parsed.project_id, owner_id, raise_http=False)
        rows = (
            db.query(ConceptMastery, Concept)
            .join(Concept, ConceptMastery.concept_id == Concept.id)
            .filter(ConceptMastery.project_id == parsed.project_id, ConceptMastery.owner_id == owner_id)
            .all()
        )
        return {
            "mastery": [
                {
                    "concept_id": m.concept_id,
                    "concept_name": c.name,
                    "mastery": round(m.mastery, 3),
                    "trend": m.trend,
                    "attempts": m.attempts,
                    "last_practiced_at": m.last_practiced_at.isoformat() if m.last_practiced_at else None,
                }
                for m, c in rows
            ]
        }

    return _run_tool(db, "get_mastery", raw, owner_id, _impl)


def get_recent_mistakes(db: Session, owner_id: str, project_id: str, limit: int = 10) -> dict:
    raw = {"project_id": project_id, "limit": limit}

    def _impl():
        parsed = GetRecentMistakesInput.model_validate(raw)
        get_owned_project(db, parsed.project_id, owner_id, raise_http=False)
        rows = (
            db.query(QuizAnswer, Concept)
            .join(Concept, QuizAnswer.concept_id == Concept.id)
            .filter(
                QuizAnswer.project_id == parsed.project_id,
                QuizAnswer.owner_id == owner_id,
            )
            .filter(
                (QuizAnswer.is_correct.is_(False)) | (QuizAnswer.understanding_level == "weak")
            )
            .order_by(QuizAnswer.created_at.desc())
            .limit(parsed.limit)
            .all()
        )
        return {
            "mistakes": [
                {
                    "concept_id": a.concept_id,
                    "concept_name": c.name,
                    "answer_text": a.answer_text[:500],
                    "understanding_level": a.understanding_level,
                    "concepts_missing": a.concepts_missing or [],
                    "created_at": a.created_at.isoformat(),
                }
                for a, c in rows
            ]
        }

    return _run_tool(db, "get_recent_mistakes", raw, owner_id, _impl)


def record_learning_event(db: Session, owner_id: str, project_id: str, type: str, payload: dict) -> dict:
    raw = {"project_id": project_id, "type": type, "payload": payload}

    def _impl():
        parsed = RecordLearningEventInput.model_validate(raw)
        get_owned_project(db, parsed.project_id, owner_id, raise_http=False)
        event_id = parsed.event_id or f"{parsed.type}:{uuid.uuid4()}"
        event = write_learning_event(
            db,
            project_id=parsed.project_id,
            owner_id=owner_id,
            event_type=parsed.type,
            payload=parsed.payload,
            event_id=event_id,
        )
        return {"event_id": event.event_id, "stored": True}

    return _run_tool(db, "record_learning_event", raw, owner_id, _impl)


def generate_quiz_question_context(db: Session, owner_id: str, project_id: str, concept: str, difficulty: str) -> dict:
    """Fetches grounding context for quiz generation (reuses retrieveContext).
    The actual LLM generation happens in services.quiz_generation, which calls
    this tool first to get grounded material."""
    raw = {"project_id": project_id, "concept": concept, "difficulty": difficulty}

    def _impl():
        parsed = GenerateQuizQuestionInput.model_validate(raw)
        get_owned_project(db, parsed.project_id, owner_id, raise_http=False)
        chunks, insufficient = retrieve_context(db, parsed.project_id, parsed.concept)
        return {
            "insufficient_evidence": insufficient,
            "context_chunks": [{"text": c.text, "material_name": c.material_name, "page_number": c.page_number} for c in chunks],
        }

    return _run_tool(db, "generate_quiz_question", raw, owner_id, _impl)
