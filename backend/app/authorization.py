"""Single enforced ownership-check path.

Every route AND every AI tool must call these instead of querying directly,
so there is exactly one place that decides "does this user own this Project."
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import Project, Space


class AuthorizationError(Exception):
    """Raised by non-HTTP callers (e.g. AI tools) instead of HTTPException."""


def get_owned_project(db: Session, project_id: str, user_id: str, *, raise_http: bool = True) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if project is None or project.owner_id != user_id:
        if raise_http:
            raise HTTPException(status_code=404, detail="Project not found")
        raise AuthorizationError(f"user {user_id} does not own project {project_id}")
    return project


def get_owned_space(db: Session, space_id: str, user_id: str, *, raise_http: bool = True) -> Space:
    space = db.query(Space).filter(Space.id == space_id).first()
    if space is None or space.owner_id != user_id:
        if raise_http:
            raise HTTPException(status_code=404, detail="Space not found")
        raise AuthorizationError(f"user {user_id} does not own space {space_id}")
    return space
