from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.config import get_settings
from app.database import get_db
from app.models.models import Concept, QuizAnswer, QuizQuestion, User
from app.rate_limit import limiter
from app.schemas.schemas import QuizAnswerResult, QuizAnswerSubmit, QuizGenerateRequest, QuizQuestionOut
from app.services.adaptive_selection import select_next_concept
from app.services.grading import grade_mcq, grade_open_ended
from app.services.quiz_generation import generate_question
from app.tools.tools import get_recent_mistakes
from app.workers.job_queue import enqueue_job

router = APIRouter(prefix="/api/projects/{project_id}/quiz", tags=["quiz"])
settings = get_settings()


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

    if body.concept_id:
        concept = (
            db.query(Concept)
            .filter(Concept.id == body.concept_id, Concept.project_id == project_id, Concept.owner_id == user.id)
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

    question.selection_score = selection_score
    question.selection_reasons = selection_reasons
    db.commit()
    db.refresh(question)
    return question


@router.post("/answer", response_model=QuizAnswerResult)
async def submit_answer(
    project_id: str,
    body: QuizAnswerSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    question = (
        db.query(QuizQuestion)
        .filter(QuizQuestion.id == body.question_id, QuizQuestion.project_id == project_id, QuizQuestion.owner_id == user.id)
        .first()
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    if question.kind == "mcq":
        is_correct = grade_mcq(question, body.answer_text)
        answer = QuizAnswer(
            question_id=question.id,
            project_id=project_id,
            owner_id=user.id,
            concept_id=question.concept_id,
            answer_text=body.answer_text,
            is_correct=is_correct,
        )
        db.add(answer)
        db.commit()
        db.refresh(answer)
        result = QuizAnswerResult(id=answer.id, is_correct=is_correct, correct_answer=question.correct_answer)
    else:
        try:
            grading = await grade_open_ended(db, user.id, project_id, question, body.answer_text)
        except ValueError as exc:
            raise HTTPException(status_code=502, detail=f"Could not grade this answer right now: {exc}")

        answer = QuizAnswer(
            question_id=question.id,
            project_id=project_id,
            owner_id=user.id,
            concept_id=question.concept_id,
            answer_text=body.answer_text,
            understanding_level=grading.understanding_level,
            concepts_covered=grading.concepts_covered,
            concepts_missing=grading.concepts_missing,
            grading_explanation=grading.explanation,
            raw_evaluation=grading.model_dump(),
        )
        db.add(answer)
        db.commit()
        db.refresh(answer)
        result = QuizAnswerResult(
            id=answer.id,
            understanding_level=grading.understanding_level,
            concepts_covered=grading.concepts_covered,
            concepts_missing=grading.concepts_missing,
            grading_explanation=grading.explanation,
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
