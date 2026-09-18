import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models.models import Concept, Flashcard
from app.schemas.schemas import FlashcardsGenerated
from app.services.llm_client import call_structured
from app.tools.tools import generate_quiz_question_context

settings = get_settings()

GEN_SYSTEM_PROMPT = """You write flashcards (front/back Q&A pairs) for a learner, grounded \
strictly in the provided material excerpts. Do not introduce facts not supported by the \
excerpts. Keep the front short (a question or term) and the back concise (1-3 sentences)."""

# SM-2-derived spaced repetition schedule.
GRADE_QUALITY = {"again": 0, "hard": 3, "good": 4, "easy": 5}


def apply_review(card: Flashcard, grade: str) -> None:
    quality = GRADE_QUALITY[grade]

    if quality < 3:
        card.repetitions = 0
        card.interval_days = 1
    else:
        card.repetitions += 1
        if card.repetitions == 1:
            card.interval_days = 1
        elif card.repetitions == 2:
            card.interval_days = 6
        else:
            card.interval_days = round(card.interval_days * card.ease_factor)

    new_ease = card.ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    card.ease_factor = max(1.3, new_ease)
    card.next_review_at = datetime.now(timezone.utc) + timedelta(days=card.interval_days)


async def _generate_for_concept(
    owner_id: str, project_id: str, concept_id: str, concept_name: str
) -> tuple[str, list[dict]] | None:
    """Runs on its own DB session so concepts can be generated concurrently
    (call_structured commits internally for usage logging, which isn't safe
    to share across concurrently-running coroutines on one session)."""
    gen_db = SessionLocal()
    try:
        ctx = generate_quiz_question_context(gen_db, owner_id, project_id, concept_name, "medium")
        if not ctx["context_chunks"]:
            return None
        material_block = "\n\n".join(
            f"Source: {c['material_name']} — Page {c['page_number']}\n{c['text']}"
            for c in ctx["context_chunks"]
        )
        user_prompt = (
            f"Concept: {concept_name}\n\nMaterial excerpts:\n{material_block}\n\n"
            f"Write 2-4 flashcards covering the key facts about this concept, grounded in the excerpts above."
        )
        try:
            generated = await call_structured(
                gen_db,
                feature="flashcard_generation",
                system_prompt=GEN_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                schema=FlashcardsGenerated,
                model=settings.quiz_model,
                project_id=project_id,
                owner_id=owner_id,
            )
        except ValueError:
            return None

        top_chunk = ctx["context_chunks"][0]
        return concept_id, [
            {
                "front": card.front,
                "back": card.back,
                "source_material_name": top_chunk["material_name"],
                "source_page_number": top_chunk["page_number"],
            }
            for card in generated.cards
        ]
    finally:
        gen_db.close()


async def generate_flashcards_for_project(db: Session, owner_id: str, project_id: str) -> list[Flashcard]:
    concepts = db.query(Concept).filter(Concept.project_id == project_id, Concept.owner_id == owner_id).all()
    if not concepts:
        raise ValueError("No concepts exist for this project yet")

    results = await asyncio.gather(
        *(_generate_for_concept(owner_id, project_id, c.id, c.name) for c in concepts)
    )

    created: list[Flashcard] = []
    for result in results:
        if not result:
            continue
        concept_id, cards = result
        for card in cards:
            flashcard = Flashcard(project_id=project_id, owner_id=owner_id, concept_id=concept_id, **card)
            db.add(flashcard)
            created.append(flashcard)

    db.commit()
    for card in created:
        db.refresh(card)
    return created
