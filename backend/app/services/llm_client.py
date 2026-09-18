"""Thin wrapper around the Groq API (OpenAI-compatible): structured
(schema-validated) calls, streaming, and centralized ai_usage_events logging."""

import json
import time
from typing import AsyncIterator, Type, TypeVar

from openai import APIError, APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.models import AIUsageEvent

settings = get_settings()
_client: AsyncOpenAI | None = None

GROQ_BASE_URL = "https://api.groq.com/openai/v1"

T = TypeVar("T", bound=BaseModel)


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.groq_api_key, base_url=GROQ_BASE_URL)
    return _client


def log_ai_usage(
    db: Session,
    feature: str,
    model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: int = 0,
    success: bool = True,
    error_message: str | None = None,
    project_id: str | None = None,
    owner_id: str | None = None,
    tool_name: str | None = None,
    tool_input: dict | None = None,
    tool_outcome: str | None = None,
) -> None:
    event = AIUsageEvent(
        project_id=project_id,
        owner_id=owner_id,
        feature=feature,
        model=model,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_outcome=tool_outcome,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
        success=success,
        error_message=error_message,
    )
    db.add(event)
    db.commit()


async def call_structured(
    db: Session,
    feature: str,
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
    model: str | None = None,
    project_id: str | None = None,
    owner_id: str | None = None,
    max_retries: int = 2,
) -> T:
    """Calls the LLM, asks for JSON matching `schema`, validates, retries on
    invalid output. Raises ValueError if all retries are exhausted (caller
    must reject/handle — never persist unvalidated output)."""
    model = model or settings.tutor_model
    client = get_client()

    schema_json = json.dumps(schema.model_json_schema())
    full_system = (
        f"{system_prompt}\n\n"
        f"Respond with ONLY a single JSON object matching this schema, no prose, "
        f"no markdown fences:\n{schema_json}"
    )

    last_error = None
    for attempt in range(max_retries + 1):
        start = time.monotonic()
        try:
            response = await client.chat.completions.create(
                model=model,
                max_tokens=1500,
                messages=[
                    {"role": "system", "content": full_system},
                    {"role": "user", "content": user_prompt},
                ],
                timeout=20.0,
            )
            latency_ms = int((time.monotonic() - start) * 1000)
            text = response.choices[0].message.content or ""
            parsed_json = _extract_json(text)
            result = schema.model_validate(parsed_json)

            log_ai_usage(
                db,
                feature=feature,
                model=model,
                prompt_tokens=response.usage.prompt_tokens if response.usage else 0,
                completion_tokens=response.usage.completion_tokens if response.usage else 0,
                latency_ms=latency_ms,
                success=True,
                project_id=project_id,
                owner_id=owner_id,
            )
            return result
        except (ValidationError, ValueError, json.JSONDecodeError, APIError, APITimeoutError, Exception) as exc:
            last_error = exc
            log_ai_usage(
                db,
                feature=feature,
                model=model,
                latency_ms=int((time.monotonic() - start) * 1000),
                success=False,
                error_message=f"validation failed (attempt {attempt + 1}): {exc}",
                project_id=project_id,
                owner_id=owner_id,
            )
            continue

    raise ValueError(f"LLM structured output failed validation after {max_retries + 1} attempts: {last_error}")


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object found in LLM output")
    return json.loads(text[start : end + 1])


async def stream_completion(
    db: Session,
    feature: str,
    system_prompt: str,
    messages: list[dict],
    model: str | None = None,
    project_id: str | None = None,
    owner_id: str | None = None,
) -> AsyncIterator[str]:
    """Yields text deltas; logs usage once the stream completes."""
    model = model or settings.tutor_model
    client = get_client()
    start = time.monotonic()

    full_text = ""
    input_tokens = 0
    output_tokens = 0
    error_message = None
    success = True

    full_messages = [{"role": "system", "content": system_prompt}] + messages

    try:
        stream = await client.chat.completions.create(
            model=model,
            max_tokens=1200,
            messages=full_messages,
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            if chunk.usage:
                input_tokens = chunk.usage.prompt_tokens
                output_tokens = chunk.usage.completion_tokens
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                full_text += delta
                yield delta
    except Exception as exc:  # noqa: BLE001
        success = False
        error_message = str(exc)
        yield f"\n\n[Error: the tutor is temporarily unavailable. Please try again.]"
    finally:
        latency_ms = int((time.monotonic() - start) * 1000)
        log_ai_usage(
            db,
            feature=feature,
            model=model,
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
            latency_ms=latency_ms,
            success=success,
            error_message=error_message,
            project_id=project_id,
            owner_id=owner_id,
        )
