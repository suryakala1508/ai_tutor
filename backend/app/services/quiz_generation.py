import random

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.models import Concept, QuizQuestion
from app.schemas.schemas import MCQGenerated, OpenEndedGenerated
from app.services.llm_client import call_structured
from app.tools.tools import generate_quiz_question_context

settings = get_settings()

GEN_SYSTEM_PROMPT = """You write quiz questions for a learner, grounded strictly in the \
provided material excerpts. Do not introduce facts not supported by the excerpts. If the \
excerpts don't cover the concept well, write a question about what IS covered rather than \
inventing content."""


async def generate_question(
    db: Session,
    owner_id: str,
    project_id: str,
    concept: Concept,
    difficulty: str,
    kind: str | None = None,
) -> QuizQuestion:
    kind = kind or random.choice(["mcq", "mcq", "open_ended"])  # mostly MCQ, some open-ended

    ctx = generate_quiz_question_context(db, owner_id, project_id, concept.name, difficulty)
    material_block = "\n\n".join(
        f"Source: {c['material_name']} — Page {c['page_number']}\n{c['text']}"
        for c in ctx["context_chunks"]
    ) or "(no material excerpts found for this concept)"

    user_prompt = (
        f"Concept: {concept.name}\nDifficulty: {difficulty}\n\n"
        f"Material excerpts:\n{material_block}\n\n"
        f"Write ONE {'multiple-choice' if kind == 'mcq' else 'open-ended'} question about this "
        f"concept at {difficulty} difficulty, grounded in the excerpts above."
    )

    schema = MCQGenerated if kind == "mcq" else OpenEndedGenerated
    generated = await call_structured(
        db,
        feature="quiz_generation",
        system_prompt=GEN_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        schema=schema,
        model=settings.quiz_model,
        project_id=project_id,
        owner_id=owner_id,
    )

    question = QuizQuestion(
        project_id=project_id,
        owner_id=owner_id,
        concept_id=concept.id,
        difficulty=difficulty,
        kind=kind,
        question_text=generated.question,
        options=generated.options if kind == "mcq" else None,
        correct_answer=generated.correct_answer if kind == "mcq" else None,
        expected_key_points=generated.expected_key_points if kind == "open_ended" else None,
        source_chunk_ids=[c["material_name"] for c in ctx["context_chunks"]],
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question
