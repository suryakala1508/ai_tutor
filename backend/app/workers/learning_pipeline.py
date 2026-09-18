from app.database import SessionLocal
from app.models.models import Concept, ConceptMastery, LearningContext, QuizAnswer
from app.services.mastery import detect_repeated_mistake, update_mastery
from app.services.recommendation import generate_recommendation
from app.workers.event_writer import write_learning_event
from app.workers.job_queue import register_handler


@register_handler("handle_quiz_answered")
async def handle_quiz_answered(payload: dict) -> None:
    answer_id = payload["answer_id"]
    db = SessionLocal()
    try:
        answer = db.query(QuizAnswer).filter(QuizAnswer.id == answer_id).first()
        if not answer:
            return

        write_learning_event(
            db,
            project_id=answer.project_id,
            owner_id=answer.owner_id,
            event_type="quiz_answered",
            payload={
                "answer_id": answer.id,
                "concept_id": answer.concept_id,
                "is_correct": answer.is_correct,
                "understanding_level": answer.understanding_level,
            },
            event_id=f"quiz_answered:{answer.id}",
        )

        mastery_row = update_mastery(
            db,
            project_id=answer.project_id,
            owner_id=answer.owner_id,
            concept_id=answer.concept_id,
            is_correct=answer.is_correct,
            understanding_level=answer.understanding_level,
        )

        if detect_repeated_mistake(db, answer.project_id, answer.concept_id):
            await _record_repeated_mistake(db, answer.project_id, answer.owner_id, answer.concept_id)

        await generate_recommendation(db, answer.project_id, answer.owner_id)
    finally:
        db.close()


async def _record_repeated_mistake(db, project_id: str, owner_id: str, concept_id: str) -> None:
    concept = db.query(Concept).filter(Concept.id == concept_id).first()
    if not concept:
        return

    ctx = db.query(LearningContext).filter(LearningContext.project_id == project_id).first()
    if ctx is None:
        ctx = LearningContext(project_id=project_id, owner_id=owner_id)
        db.add(ctx)
        db.flush()

    repeated = list(ctx.repeated_mistakes or [])
    existing = next((r for r in repeated if r.get("concept_id") == concept_id), None)
    if existing:
        existing["count"] = existing.get("count", 0) + 1
    else:
        repeated.append({"concept_id": concept_id, "concept_name": concept.name, "count": 2})
    ctx.repeated_mistakes = repeated

    weaknesses = list(ctx.weaknesses or [])
    if not any(w.get("concept_id") == concept_id for w in weaknesses):
        weaknesses.append({"concept_id": concept_id, "concept_name": concept.name, "note": "repeated mistakes detected"})
        ctx.weaknesses = weaknesses

    db.commit()

    write_learning_event(
        db,
        project_id=project_id,
        owner_id=owner_id,
        event_type="repeated_mistake_detected",
        payload={"concept_id": concept_id, "concept_name": concept.name},
        event_id=f"repeated_mistake:{concept_id}:{db.query(QuizAnswer).filter(QuizAnswer.concept_id == concept_id).count()}",
    )


@register_handler("handle_assessment_completed")
async def handle_assessment_completed(payload: dict) -> None:
    project_id = payload["project_id"]
    owner_id = payload["owner_id"]
    db = SessionLocal()
    try:
        write_learning_event(
            db,
            project_id=project_id,
            owner_id=owner_id,
            event_type="assessment_completed",
            payload=payload,
            event_id=f"assessment_completed:{payload.get('assessment_id', project_id)}",
        )
        await generate_recommendation(db, project_id, owner_id)
    finally:
        db.close()
