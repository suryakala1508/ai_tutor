from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.database import get_db
from app.models.models import Flashcard, User
from app.schemas.schemas import FlashcardOut, FlashcardReviewRequest
from app.services.flashcards import apply_review, generate_flashcards_for_project

router = APIRouter(prefix="/api/projects/{project_id}/flashcards", tags=["flashcards"])


@router.get("", response_model=list[FlashcardOut])
def list_flashcards(
    project_id: str,
    due_only: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    query = db.query(Flashcard).filter(Flashcard.project_id == project_id, Flashcard.owner_id == user.id)
    if due_only:
        query = query.filter(Flashcard.next_review_at <= datetime.now(timezone.utc))
    return query.order_by(Flashcard.next_review_at.asc()).all()


@router.post("/generate")
async def generate_flashcards(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    try:
        created = await generate_flashcards_for_project(db, user.id, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {"created": len(created)}


@router.post("/{card_id}/review", response_model=FlashcardOut)
def review_flashcard(
    project_id: str,
    card_id: str,
    body: FlashcardReviewRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    card = (
        db.query(Flashcard)
        .filter(Flashcard.id == card_id, Flashcard.project_id == project_id, Flashcard.owner_id == user.id)
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Flashcard not found")

    apply_review(card, body.grade)
    db.commit()
    db.refresh(card)
    return card
