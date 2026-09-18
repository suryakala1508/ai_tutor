from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project, get_owned_space
from app.database import get_db
from app.models.models import Project, User
from app.schemas.schemas import ProjectCreate, ProjectOut

router = APIRouter(prefix="/api/spaces/{space_id}/projects", tags=["projects"])


@router.post("", response_model=ProjectOut)
def create_project(
    space_id: str,
    body: ProjectCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_space(db, space_id, user.id)
    project = Project(space_id=space_id, owner_id=user.id, name=body.name, goal=body.goal)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("", response_model=list[ProjectOut])
def list_projects(
    space_id: str,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_space(db, space_id, user.id)
    limit = min(max(limit, 1), 100)
    return (
        db.query(Project)
        .filter(Project.space_id == space_id, Project.owner_id == user.id)
        .order_by(Project.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    space_id: str,
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_space(db, space_id, user.id)
    return get_owned_project(db, project_id, user.id)


@router.delete("/{project_id}")
def delete_project(
    space_id: str,
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_space(db, space_id, user.id)
    project = get_owned_project(db, project_id, user.id)
    db.delete(project)
    db.commit()
    return {"deleted": True}
