import json
import time
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.config import get_settings
from app.database import get_db, SessionLocal
from app.models.models import ConversationMessage, User
from app.rate_limit import limiter
from app.schemas.schemas import TutorMessageRequest
from app.services.llm_client import log_ai_usage
from app.services.tutor import assemble_context, extract_citations_used
from app.tools.tools import record_learning_event
from anthropic import AsyncAnthropic, APIError, APITimeoutError

router = APIRouter(prefix="/api/projects/{project_id}/tutor", tags=["tutor"])
settings = get_settings()


@router.post("/message")
@limiter.limit(settings.rate_limit_tutor)
async def send_message(
    request: Request,
    project_id: str,
    body: TutorMessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    user_msg = ConversationMessage(
        project_id=project_id,
        owner_id=user.id,
        conversation_id=body.conversation_id,
        role="user",
        content=body.message,
    )
    db.add(user_msg)
    db.commit()

    ctx = assemble_context(db, user.id, project_id, body.conversation_id, body.message)

    async def event_stream():
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        messages = ctx["recent_turns"] + [{"role": "user", "content": body.message}]

        full_text = ""
        input_tokens = 0
        output_tokens = 0
        success = True
        error_message = None
        start = time.monotonic()

        try:
            async with client.messages.stream(
                model=settings.tutor_model,
                max_tokens=1200,
                system=ctx["system_prompt"],
                messages=messages,
            ) as stream:
                async for delta in stream.text_stream:
                    full_text += delta
                    yield f"data: {json.dumps({'type': 'delta', 'text': delta})}\n\n"
                final = await stream.get_final_message()
                input_tokens = final.usage.input_tokens
                output_tokens = final.usage.output_tokens
        except (APITimeoutError, APIError, Exception) as exc:  # noqa: BLE001
            success = False
            error_message = str(exc)
            fallback = "The tutor is temporarily unavailable. Please try again in a moment."
            full_text = fallback
            yield f"data: {json.dumps({'type': 'delta', 'text': fallback})}\n\n"

        latency_ms = int((time.monotonic() - start) * 1000)

        db2 = SessionLocal()
        try:
            citations = extract_citations_used(full_text, ctx["citation_candidates"]) if success else []
            assistant_msg = ConversationMessage(
                project_id=project_id,
                owner_id=user.id,
                conversation_id=body.conversation_id,
                role="assistant",
                content=full_text,
                citations=citations,
                retrieval_ids_used=ctx["retrieval_ids_used"],
                insufficient_evidence=ctx["insufficient_evidence"],
                model=settings.tutor_model,
                latency_ms=latency_ms,
                prompt_tokens=input_tokens,
                completion_tokens=output_tokens,
            )
            db2.add(assistant_msg)
            db2.commit()

            log_ai_usage(
                db2,
                feature="tutor",
                model=settings.tutor_model,
                prompt_tokens=input_tokens,
                completion_tokens=output_tokens,
                latency_ms=latency_ms,
                success=success,
                error_message=error_message,
                project_id=project_id,
                owner_id=user.id,
            )

            record_learning_event(
                db2,
                owner_id=user.id,
                project_id=project_id,
                type="tutor_conversation",
                payload={
                    "conversation_id": body.conversation_id,
                    "message_id": assistant_msg.id,
                    "insufficient_evidence": ctx["insufficient_evidence"],
                },
            )
        finally:
            db2.close()

        yield f"data: {json.dumps({'type': 'done', 'citations': citations, 'insufficient_evidence': ctx['insufficient_evidence'], 'token_log': ctx['token_log'], 'context_selection_log': ctx['context_selection_log']})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/conversations/{conversation_id}")
def get_conversation(
    project_id: str,
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    rows = (
        db.query(ConversationMessage)
        .filter(
            ConversationMessage.project_id == project_id,
            ConversationMessage.conversation_id == conversation_id,
            ConversationMessage.owner_id == user.id,
        )
        .order_by(ConversationMessage.created_at.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "role": r.role,
            "content": r.content,
            "citations": r.citations,
            "insufficient_evidence": r.insufficient_evidence,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
