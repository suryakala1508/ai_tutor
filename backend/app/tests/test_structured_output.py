from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from pydantic import BaseModel

from app.models.models import Project, Space, User
from app.services.llm_client import call_structured


class DummySchema(BaseModel):
    question: str
    answer: str


def _fake_response(text: str, input_tokens=10, output_tokens=5):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=text)],
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
    )


def _make_user_project(db, email="s@test.com"):
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
async def test_valid_structured_output_is_accepted(db_session):
    user, project = _make_user_project(db_session, "s1@test.com")
    valid_json = '{"question": "What is X?", "answer": "X is Y"}'

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=_fake_response(valid_json))

    with patch("app.services.llm_client.get_client", return_value=mock_client):
        result = await call_structured(
            db_session, "test_feature", "system", "user prompt", DummySchema,
            project_id=project.id, owner_id=user.id,
        )
    assert result.question == "What is X?"


@pytest.mark.asyncio
async def test_malformed_json_is_rejected_and_retried_then_raises(db_session):
    user, project = _make_user_project(db_session, "s2@test.com")

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=_fake_response("this is not json at all"))

    with patch("app.services.llm_client.get_client", return_value=mock_client):
        with pytest.raises(ValueError):
            await call_structured(
                db_session, "test_feature", "system", "user prompt", DummySchema,
                project_id=project.id, owner_id=user.id, max_retries=1,
            )
    # retried: initial attempt + 1 retry = 2 calls
    assert mock_client.messages.create.call_count == 2


@pytest.mark.asyncio
async def test_json_missing_required_fields_is_rejected(db_session):
    user, project = _make_user_project(db_session, "s3@test.com")
    missing_field_json = '{"question": "What is X?"}'  # missing "answer"

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=_fake_response(missing_field_json))

    with patch("app.services.llm_client.get_client", return_value=mock_client):
        with pytest.raises(ValueError):
            await call_structured(
                db_session, "test_feature", "system", "user prompt", DummySchema,
                project_id=project.id, owner_id=user.id, max_retries=0,
            )


@pytest.mark.asyncio
async def test_recovery_after_one_bad_attempt_then_valid_output(db_session):
    user, project = _make_user_project(db_session, "s4@test.com")
    valid_json = '{"question": "Q", "answer": "A"}'

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(
        side_effect=[_fake_response("garbage"), _fake_response(valid_json)]
    )

    with patch("app.services.llm_client.get_client", return_value=mock_client):
        result = await call_structured(
            db_session, "test_feature", "system", "user prompt", DummySchema,
            project_id=project.id, owner_id=user.id, max_retries=2,
        )
    assert result.answer == "A"
    assert mock_client.messages.create.call_count == 2


@pytest.mark.asyncio
async def test_invalid_output_never_persisted_by_grading(db_session):
    """Structured grading output that fails validation must not be stored as a QuizAnswer."""
    from app.models.models import Concept, QuizQuestion
    from app.services.grading import grade_open_ended

    user, project = _make_user_project(db_session, "s5@test.com")
    concept = Concept(project_id=project.id, owner_id=user.id, name="Test Concept")
    db_session.add(concept)
    db_session.commit()
    db_session.refresh(concept)

    question = QuizQuestion(
        project_id=project.id,
        owner_id=user.id,
        concept_id=concept.id,
        kind="open_ended",
        question_text="Explain X",
        expected_key_points=["point 1", "point 2"],
    )
    db_session.add(question)
    db_session.commit()
    db_session.refresh(question)

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=_fake_response("not valid json"))

    with patch("app.services.llm_client.get_client", return_value=mock_client):
        with pytest.raises(ValueError):
            await grade_open_ended(db_session, user.id, project.id, question, "my answer")

    from app.models.models import QuizAnswer

    count = db_session.query(QuizAnswer).filter(QuizAnswer.question_id == question.id).count()
    assert count == 0
