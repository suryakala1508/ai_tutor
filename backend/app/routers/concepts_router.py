from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.database import get_db
from app.models.models import Concept, User

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
