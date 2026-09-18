from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.models import Concept
from app.schemas.schemas import ORMBase
from app.services.llm_client import call_structured
from pydantic import BaseModel, ConfigDict, Field

settings = get_settings()

EXTRACT_SYSTEM_PROMPT = """Extract the 3-8 main learnable concepts (short names, e.g. \
"Gradient Descent", "Supply and Demand") covered in this material excerpt. These will be used \
to track a learner's mastery, so keep names concise and non-overlapping."""


class ExtractedConcepts(BaseModel):
    concepts: list[str] = Field(min_length=1, max_length=8)

    model_config = ConfigDict(extra="forbid")


async def extract_and_store_concepts(db: Session, project_id: str, owner_id: str, text: str) -> list[str]:
    sample = text[:6000]
    if not sample.strip():
        return []

    try:
        result = await call_structured(
            db,
            feature="concept_extraction",
            system_prompt=EXTRACT_SYSTEM_PROMPT,
            user_prompt=f"Material excerpt:\n{sample}",
            schema=ExtractedConcepts,
            model=settings.tutor_model,
            project_id=project_id,
            owner_id=owner_id,
        )
    except Exception:  # noqa: BLE001
        return []  # extraction is best-effort; skip on failure rather than block material processing

    stored = []
    for name in result.concepts:
        name = name.strip()
        if not name:
            continue
        existing = db.query(Concept).filter(Concept.project_id == project_id, Concept.name == name).first()
        if existing:
            stored.append(existing.name)
            continue
        concept = Concept(project_id=project_id, owner_id=owner_id, name=name)
        db.add(concept)
        try:
            db.commit()
            stored.append(name)
        except IntegrityError:
            db.rollback()
    return stored
