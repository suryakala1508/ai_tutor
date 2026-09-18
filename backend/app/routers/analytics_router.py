from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.database import get_db
from app.models.models import (
    AIUsageEvent,
    Concept,
    ConceptMastery,
    LearningEvent,
    MasterySnapshot,
    Project,
    QuizAnswer,
    Recommendation,
    Space,
    User,
)

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/projects/{project_id}/analytics")
def project_analytics(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    events = (
        db.query(LearningEvent)
        .filter(LearningEvent.project_id == project_id, LearningEvent.owner_id == user.id)
        .order_by(LearningEvent.created_at.desc())
        .limit(50)
        .all()
    )

    mastery_rows = (
        db.query(ConceptMastery, Concept)
        .join(Concept, ConceptMastery.concept_id == Concept.id)
        .filter(ConceptMastery.project_id == project_id, ConceptMastery.owner_id == user.id)
        .all()
    )

    trend_points = (
        db.query(MasterySnapshot, Concept)
        .join(Concept, MasterySnapshot.concept_id == Concept.id)
        .filter(MasterySnapshot.project_id == project_id, MasterySnapshot.owner_id == user.id)
        .order_by(MasterySnapshot.created_at.asc())
        .limit(500)
        .all()
    )

    since = datetime.now(timezone.utc) - timedelta(days=30)
    answers = (
        db.query(QuizAnswer)
        .filter(
            QuizAnswer.project_id == project_id,
            QuizAnswer.owner_id == user.id,
            QuizAnswer.created_at >= since,
        )
        .order_by(QuizAnswer.created_at.asc())
        .all()
    )

    ai_agg = (
        db.query(
            AIUsageEvent.feature,
            func.count(AIUsageEvent.id).label("calls"),
            func.sum(AIUsageEvent.prompt_tokens).label("prompt_tokens"),
            func.sum(AIUsageEvent.completion_tokens).label("completion_tokens"),
        )
        .filter(AIUsageEvent.project_id == project_id, AIUsageEvent.owner_id == user.id)
        .group_by(AIUsageEvent.feature)
        .all()
    )

    return {
        "activity_timeline": [
            {"type": e.type, "payload": e.payload, "created_at": e.created_at.isoformat()} for e in events
        ],
        "mastery_by_concept": [
            {"concept_id": m.concept_id, "concept_name": c.name, "mastery": round(m.mastery, 3), "trend": m.trend}
            for m, c in mastery_rows
        ],
        "mastery_trend_chart": [
            {
                "concept_id": s.concept_id,
                "concept_name": c.name,
                "mastery": round(s.mastery, 3),
                "created_at": s.created_at.isoformat(),
            }
            for s, c in trend_points
        ],
        "assessment_performance_over_time": [
            {
                "created_at": a.created_at.isoformat(),
                "is_correct": a.is_correct,
                "understanding_level": a.understanding_level,
            }
            for a in answers
        ],
        "ai_activity_summary": [
            {
                "feature": row.feature,
                "calls": row.calls,
                "prompt_tokens": row.prompt_tokens or 0,
                "completion_tokens": row.completion_tokens or 0,
            }
            for row in ai_agg
        ],
    }


@router.get("/home")
def home_dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recent_projects = (
        db.query(Project)
        .filter(Project.owner_id == user.id)
        .order_by(Project.created_at.desc())
        .limit(5)
        .all()
    )

    mastery_rows = db.query(ConceptMastery).filter(ConceptMastery.owner_id == user.id).all()
    overall_avg_mastery = (
        round(sum(m.mastery for m in mastery_rows) / len(mastery_rows), 3) if mastery_rows else None
    )
    needs_attention = (
        db.query(ConceptMastery, Concept)
        .join(Concept, ConceptMastery.concept_id == Concept.id)
        .filter(ConceptMastery.owner_id == user.id, ConceptMastery.trend == "needs-attention")
        .limit(10)
        .all()
    )

    latest_recommendation = (
        db.query(Recommendation)
        .filter(Recommendation.owner_id == user.id)
        .order_by(Recommendation.created_at.desc())
        .first()
    )

    return {
        "recent_projects": [{"id": p.id, "name": p.name, "space_id": p.space_id} for p in recent_projects],
        "overall_progress": {
            "average_mastery": overall_avg_mastery,
            "tracked_concepts": len(mastery_rows),
        },
        "areas_requiring_attention": [
            {"concept_id": m.concept_id, "concept_name": c.name, "project_id": m.project_id, "mastery": round(m.mastery, 3)}
            for m, c in needs_attention
        ],
        "recommended_next_action": (
            {"action_text": latest_recommendation.action_text, "project_id": latest_recommendation.project_id}
            if latest_recommendation
            else None
        ),
    }
