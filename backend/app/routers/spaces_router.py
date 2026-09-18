from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_space
from app.database import get_db
from app.models.models import Space, User
from app.schemas.schemas import SpaceCreate, SpaceOut

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


@router.post("", response_model=SpaceOut)
def create_space(body: SpaceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    space = Space(owner_id=user.id, name=body.name, description=body.description)
    db.add(space)
    db.commit()
    db.refresh(space)
    return space


@router.get("", response_model=list[SpaceOut])
def list_spaces(
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = min(max(limit, 1), 100)
    return (
        db.query(Space)
        .filter(Space.owner_id == user.id)
        .order_by(Space.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/{space_id}", response_model=SpaceOut)
def get_space(space_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_owned_space(db, space_id, user.id)


@router.delete("/{space_id}")
def delete_space(space_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    space = get_owned_space(db, space_id, user.id)
    db.delete(space)
    db.commit()
    return {"deleted": True}
