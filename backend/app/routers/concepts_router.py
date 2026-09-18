from collections import defaultdict
from itertools import combinations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.database import get_db
from app.models.models import Concept, ConceptMastery, QuizQuestion, User

router = APIRouter(prefix="/api/projects/{project_id}/concepts", tags=["concepts"])


class ConceptCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)

    model_config = ConfigDict(extra="forbid")


class ConceptOut(BaseModel):
    id: str
    name: str
    description: str

    model_config = ConfigDict(from_attributes=True)


@router.post("", response_model=ConceptOut)
def create_concept(
    project_id: str,
    body: ConceptCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    concept = Concept(project_id=project_id, owner_id=user.id, name=body.name, description=body.description)
    db.add(concept)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Concept with this name already exists in this project")
    db.refresh(concept)
    return concept


@router.get("", response_model=list[ConceptOut])
def list_concepts(
    project_id: str,
    limit: int = 100,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    limit = min(max(limit, 1), 200)
    return (
        db.query(Concept)
        .filter(Concept.project_id == project_id, Concept.owner_id == user.id)
        .order_by(Concept.created_at.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/map")
def concept_map(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    concepts = db.query(Concept).filter(Concept.project_id == project_id, Concept.owner_id == user.id).all()
    mastery_rows = (
        db.query(ConceptMastery)
        .filter(ConceptMastery.project_id == project_id, ConceptMastery.owner_id == user.id)
        .all()
    )
    mastery_by_concept = {m.concept_id: m for m in mastery_rows}

    nodes = [
        {
            "concept_id": c.id,
            "name": c.name,
            "mastery": round(mastery_by_concept[c.id].mastery, 3) if c.id in mastery_by_concept else 0.3,
            "trend": mastery_by_concept[c.id].trend if c.id in mastery_by_concept else "stable",
            "attempts": mastery_by_concept[c.id].attempts if c.id in mastery_by_concept else 0,
        }
        for c in concepts
    ]

    # Edge weight = how often two concepts were quizzed together in the same session,
    # the one real "these concepts are related" signal available without inventing data.
    questions = (
        db.query(QuizQuestion)
        .filter(
            QuizQuestion.project_id == project_id,
            QuizQuestion.owner_id == user.id,
            QuizQuestion.session_id.isnot(None),
        )
        .all()
    )
    concepts_by_session: dict[str, set[str]] = defaultdict(set)
    for q in questions:
        concepts_by_session[q.session_id].add(q.concept_id)

    edge_weights: dict[tuple[str, str], int] = defaultdict(int)
    for concept_ids in concepts_by_session.values():
        for a, b in combinations(sorted(concept_ids), 2):
            edge_weights[(a, b)] += 1

    edges = [{"source": a, "target": b, "weight": w} for (a, b), w in edge_weights.items()]

    return {"nodes": nodes, "edges": edges}
