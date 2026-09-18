from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.config import get_settings
from app.database import get_db
from app.models.models import Concept, QuizAnswer, QuizQuestion, QuizSession, User
from app.rate_limit import limiter
from app.schemas.schemas import (
    ConceptStat,
    QuizAnswerResult,
    QuizAnswerSubmit,
    QuizGenerateRequest,
    QuizQuestionOut,
    QuizSessionOut,
    QuizSessionSummary,
)
from app.services.adaptive_selection import select_next_concept
from app.services.grading import grade_mcq, grade_open_ended
from app.services.quiz_generation import generate_question
from app.tools.tools import get_recent_mistakes
from app.workers.job_queue import enqueue_job

router = APIRouter(prefix="/api/projects/{project_id}/quiz", tags=["quiz"])
settings = get_settings()


async def _generate_question_for_project(
    db: Session, project_id: str, user: User, concept_id: str | None, session_id: str | None
) -> QuizQuestion:
    if concept_id:
        concept = (
            db.query(Concept)
            .filter(Concept.id == concept_id, Concept.project_id == project_id, Concept.owner_id == user.id)
            .first()
        )
        if not concept:
            raise HTTPException(status_code=404, detail="Concept not found")
        difficulty = "medium"
        selection_score, selection_reasons = None, {"note": "concept explicitly requested, adaptive selection skipped"}
    else:
        mistakes = get_recent_mistakes(db, user.id, project_id)["mistakes"]
        mistake_concept_ids = {m["concept_id"] for m in mistakes}
        pick = select_next_concept(db, project_id, user.id, mistake_concept_ids)
        if not pick:
            raise HTTPException(status_code=422, detail="No concepts exist for this project yet")
        concept = (
            db.query(Concept)
            .filter(Concept.id == pick["concept_id"], Concept.project_id == project_id, Concept.owner_id == user.id)
            .first()
        )
        difficulty = pick["difficulty"]
        selection_score, selection_reasons = pick["score"], pick["reasons"]

    try:
        question = await generate_question(db, user.id, project_id, concept, difficulty)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"Could not generate a valid question: {exc}")

    question.session_id = session_id
    question.selection_score = selection_score
    question.selection_reasons = selection_reasons
    db.commit()
    db.refresh(question)
    return question


async def _submit_answer(db: Session, project_id: str, user: User, question_id: str, answer_text: str) -> QuizAnswerResult:
    question = (
        db.query(QuizQuestion)
        .filter(QuizQuestion.id == question_id, QuizQuestion.project_id == project_id, QuizQuestion.owner_id == user.id)
        .first()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if question.kind == "mcq":
        is_correct = grade_mcq(question, answer_text)
        answer = QuizAnswer(
            question_id=question.id,
            project_id=project_id,
            owner_id=user.id,
            concept_id=question.concept_id,
            answer_text=answer_text,
            is_correct=is_correct,
        )
        db.add(answer)
        db.commit()
        db.refresh(answer)
        result = QuizAnswerResult(id=answer.id, is_correct=is_correct, correct_answer=question.correct_answer)
    else:
        try:
            grading = await grade_open_ended(db, user.id, project_id, question, answer_text)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail=f"Could not grade this answer right now: {exc}")

        is_correct = grading.understanding_level == "strong"
        answer = QuizAnswer(
            question_id=question.id,
            project_id=project_id,
            owner_id=user.id,
            concept_id=question.concept_id,
            answer_text=answer_text,
            is_correct=is_correct,
            understanding_level=grading.understanding_level,
            accuracy=grading.accuracy,
            relevance=grading.relevance,
            concepts_covered=grading.concepts_covered,
            concepts_missing=grading.concepts_missing,
            grading_explanation=grading.explanation,
            how_to_improve=grading.how_to_improve,
            raw_evaluation=grading.model_dump(),
        )
        db.add(answer)
        db.commit()
        db.refresh(answer)
        result = QuizAnswerResult(
            id=answer.id,
            is_correct=is_correct,
            understanding_level=grading.understanding_level,
            accuracy=grading.accuracy,
            relevance=grading.relevance,
            concepts_covered=grading.concepts_covered,
            concepts_missing=grading.concepts_missing,
            grading_explanation=grading.explanation,
            how_to_improve=grading.how_to_improve,
        )

    # Quiz-answered event + downstream mastery/recommendation pipeline run as a
    # background job so this response returns immediately (Phase 8 requirement).
    enqueue_job(
        "handle_quiz_answered",
        {"answer_id": answer.id},
        project_id=project_id,
        owner_id=user.id,
        idempotency_key=f"handle_quiz_answered:{answer.id}",
    )

    return result


def _get_owned_session(db: Session, project_id: str, session_id: str, user: User) -> QuizSession:
    session = (
        db.query(QuizSession)
        .filter(QuizSession.id == session_id, QuizSession.project_id == project_id, QuizSession.owner_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Quiz session not found")
    return session


def _session_summary(db: Session, session: QuizSession) -> QuizSessionSummary:
    questions = db.query(QuizQuestion).filter(QuizQuestion.session_id == session.id).all()
    question_ids = [q.id for q in questions]
    answers = (
        db.query(QuizAnswer).filter(QuizAnswer.question_id.in_(question_ids)).all() if question_ids else []
    )
    answers_by_question = {a.question_id: a for a in answers}

    concept_names = {q.id: q.concept_id for q in questions}
    concepts = (
        db.query(Concept).filter(Concept.id.in_(set(concept_names.values()))).all() if concept_names else []
    )
    concept_name_by_id = {c.id: c.name for c in concepts}

    stats: dict[str, ConceptStat] = {}
    for q in questions:
        answer = answers_by_question.get(q.id)
        if not answer:
            continue
        stat = stats.setdefault(
            q.concept_id,
            ConceptStat(concept_id=q.concept_id, concept_name=concept_name_by_id.get(q.concept_id, ""), questions=0, correct=0),
        )
        stat.questions += 1
        if answer.is_correct:
            stat.correct += 1

    answered = list(answers_by_question.values())
    correct_count = sum(1 for a in answered if a.is_correct)
    accuracy = (correct_count / len(answered)) if answered else None

    return QuizSessionSummary(
        id=session.id,
        status=session.status,
        started_at=session.started_at,
        completed_at=session.completed_at,
        questions_generated=len(questions),
        questions_answered=len(answered),
        correct_count=correct_count,
        accuracy=accuracy,
        concepts_practiced=list(stats.values()),
    )


@router.post("/sessions", response_model=QuizSessionOut)
def create_session(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    session = QuizSession(project_id=project_id, owner_id=user.id, status="active")
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/sessions", response_model=list[QuizSessionSummary])
def list_sessions(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    sessions = (
        db.query(QuizSession)
        .filter(QuizSession.project_id == project_id, QuizSession.owner_id == user.id)
        .order_by(QuizSession.started_at.desc())
        .limit(50)
        .all()
    )
    return [_session_summary(db, s) for s in sessions]


@router.post("/sessions/{session_id}/generate", response_model=QuizQuestionOut)
@limiter.limit(settings.rate_limit_quiz_gen)
async def generate_session_question(
    request: Request,
    project_id: str,
    session_id: str,
    body: QuizGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    session = _get_owned_session(db, project_id, session_id, user)
    if session.status != "active":
        raise HTTPException(status_code=409, detail="This quiz session has already ended")
    return await _generate_question_for_project(db, project_id, user, body.concept_id, session_id)


@router.post("/sessions/{session_id}/answer", response_model=QuizAnswerResult)
async def submit_session_answer(
    project_id: str,
    session_id: str,
    body: QuizAnswerSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    session = _get_owned_session(db, project_id, session_id, user)
    if session.status != "active":
        raise HTTPException(status_code=409, detail="This quiz session has already ended")
    return await _submit_answer(db, project_id, user, body.question_id, body.answer_text)


@router.post("/sessions/{session_id}/complete", response_model=QuizSessionSummary)
def complete_session(
    project_id: str,
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    session = _get_owned_session(db, project_id, session_id, user)
    if session.status == "active":
        session.status = "completed"
        session.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)
    return _session_summary(db, session)


@router.post("/generate", response_model=QuizQuestionOut)
@limiter.limit(settings.rate_limit_quiz_gen)
async def generate(
    request: Request,
    project_id: str,
    body: QuizGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    return await _generate_question_for_project(db, project_id, user, body.concept_id, None)


@router.post("/answer", response_model=QuizAnswerResult)
async def submit_answer(
    project_id: str,
    body: QuizAnswerSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    return await _submit_answer(db, project_id, user, body.question_id, body.answer_text)
