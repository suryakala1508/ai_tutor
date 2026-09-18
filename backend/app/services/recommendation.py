from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.models import Concept, ConceptMastery, LearningContext, Project, Recommendation
from app.schemas.schemas import RecommendationGenerated
from app.services.llm_client import call_structured

settings = get_settings()

REC_SYSTEM_PROMPT = """You give a learner ONE prioritized, specific next action based on their \
mastery trends, weak concepts, and goal. Be concrete and plain-language (e.g. name the \
concept and the type of practice needed). One recommendation only, 1-3 sentences."""


async def generate_recommendation(db: Session, project_id: str, owner_id: str) -> Recommendation | None:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return None

    mastery_rows = (
        db.query(ConceptMastery, Concept)
        .join(Concept, ConceptMastery.concept_id == Concept.id)
        .filter(ConceptMastery.project_id == project_id)
        .all()
    )
    if not mastery_rows:
        return None

    ctx = db.query(LearningContext).filter(LearningContext.project_id == project_id).first()

    trend_lines = "\n".join(
        f"- {c.name}: mastery={round(m.mastery, 2)}, trend={m.trend}, attempts={m.attempts}"
        for m, c in mastery_rows
    )
    repeated = ", ".join(r.get("concept_name", "") for r in (ctx.repeated_mistakes if ctx else []) or []) or "none"

    user_prompt = (
        f"Learner goal: {project.goal or '(not specified)'}\n\n"
        f"Concept mastery trends:\n{trend_lines}\n\n"
        f"Repeated mistake concepts: {repeated}\n\n"
        f"Give the ONE most useful next action for this learner right now."
    )

    try:
        generated = await call_structured(
            db,
            feature="recommendation",
            system_prompt=REC_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            schema=RecommendationGenerated,
            model=settings.recommendation_model,
            project_id=project_id,
            owner_id=owner_id,
        )
    except ValueError:
        return None  # invalid structured output: skip this cycle rather than store garbage

    concept_id = None
    if generated.concept_name:
        match = next((c for m, c in mastery_rows if c.name.lower() == generated.concept_name.lower()), None)
        concept_id = match.id if match else None

    rec = Recommendation(
        project_id=project_id,
        owner_id=owner_id,
        concept_id=concept_id,
        action_text=generated.action_text,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec
