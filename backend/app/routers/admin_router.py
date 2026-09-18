from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models.models import (
    AIUsageEvent,
    BackgroundJob,
    EvalRun,
    LearningEvent,
    Project,
    Space,
    User,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
def list_users(
    limit: int = 50,
    offset: int = 0,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    limit = min(max(limit, 1), 200)
    users = db.query(User).order_by(User.created_at.desc()).offset(offset).limit(limit).all()
    return [{"id": u.id, "email": u.email, "is_admin": u.is_admin, "created_at": u.created_at.isoformat()} for u in users]


@router.get("/users/{user_id}")
def user_journey(user_id: str, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        return {"error": "not found"}

    spaces = db.query(Space).filter(Space.owner_id == user_id).all()
    projects = db.query(Project).filter(Project.owner_id == user_id).all()
    events = (
        db.query(LearningEvent)
        .filter(LearningEvent.owner_id == user_id)
        .order_by(LearningEvent.created_at.desc())
        .limit(100)
        .all()
    )
    ai_usage = (
        db.query(AIUsageEvent)
        .filter(AIUsageEvent.owner_id == user_id)
        .order_by(AIUsageEvent.created_at.desc())
        .limit(100)
        .all()
    )

    return {
        "user": {"id": target.id, "email": target.email, "is_admin": target.is_admin},
        "spaces": [{"id": s.id, "name": s.name} for s in spaces],
        "projects": [{"id": p.id, "name": p.name, "space_id": p.space_id} for p in projects],
        "recent_activity": [{"type": e.type, "created_at": e.created_at.isoformat()} for e in events],
        "recent_ai_usage": [
            {"feature": a.feature, "model": a.model, "success": a.success, "created_at": a.created_at.isoformat()}
            for a in ai_usage
        ],
    }


@router.get("/activity")
def platform_activity(
    user_id: str | None = None,
    project_id: str | None = None,
    event_type: str | None = None,
    limit: int = 100,
    offset: int = 0,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    limit = min(max(limit, 1), 500)
    query = db.query(LearningEvent)
    if user_id:
        query = query.filter(LearningEvent.owner_id == user_id)
    if project_id:
        query = query.filter(LearningEvent.project_id == project_id)
    if event_type:
        query = query.filter(LearningEvent.type == event_type)
    rows = query.order_by(LearningEvent.created_at.desc()).offset(offset).limit(limit).all()
    return [
        {
            "id": e.id,
            "type": e.type,
            "project_id": e.project_id,
            "owner_id": e.owner_id,
            "created_at": e.created_at.isoformat(),
        }
        for e in rows
    ]


@router.get("/ai-usage")
def ai_usage_panel(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = (
        db.query(
            AIUsageEvent.feature,
            func.count(AIUsageEvent.id).label("calls"),
            func.avg(AIUsageEvent.latency_ms).label("avg_latency_ms"),
            func.sum(AIUsageEvent.prompt_tokens).label("prompt_tokens"),
            func.sum(AIUsageEvent.completion_tokens).label("completion_tokens"),
        )
        .filter(AIUsageEvent.created_at >= since)
        .group_by(AIUsageEvent.feature)
        .all()
    )

    total = db.query(func.count(AIUsageEvent.id)).filter(AIUsageEvent.created_at >= since).scalar() or 0
    failures = (
        db.query(func.count(AIUsageEvent.id))
        .filter(AIUsageEvent.created_at >= since, AIUsageEvent.success.is_(False))
        .scalar()
        or 0
    )

    # Rough cost estimate: $3/1M input tokens, $15/1M output tokens (placeholder rates).
    prompt_tokens = db.query(func.sum(AIUsageEvent.prompt_tokens)).filter(AIUsageEvent.created_at >= since).scalar() or 0
    completion_tokens = (
        db.query(func.sum(AIUsageEvent.completion_tokens)).filter(AIUsageEvent.created_at >= since).scalar() or 0
    )
    estimated_cost_usd = round((prompt_tokens / 1_000_000) * 3 + (completion_tokens / 1_000_000) * 15, 4)

    return {
        "by_feature": [
            {
                "feature": row.feature,
                "calls": row.calls,
                "avg_latency_ms": round(row.avg_latency_ms or 0, 1),
                "prompt_tokens": row.prompt_tokens or 0,
                "completion_tokens": row.completion_tokens or 0,
            }
            for row in rows
        ],
        "success_rate": round(1 - (failures / total), 4) if total else None,
        "total_calls_30d": total,
        "estimated_cost_usd_30d": estimated_cost_usd,
    }


@router.get("/evals")
def eval_panel(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(EvalRun).order_by(EvalRun.created_at.desc()).limit(20).all()
    return [
        {
            "suite": r.suite,
            "passed": r.passed,
            "failed": r.failed,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/jobs")
def jobs_panel(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = (
        db.query(BackgroundJob.status, func.count(BackgroundJob.id).label("count"))
        .group_by(BackgroundJob.status)
        .all()
    )
    return {row.status: row.count for row in rows}


@router.get("/health")
def system_health(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False

    since = datetime.now(timezone.utc) - timedelta(hours=1)
    recent_errors = (
        db.query(func.count(AIUsageEvent.id))
        .filter(AIUsageEvent.created_at >= since, AIUsageEvent.success.is_(False))
        .scalar()
        or 0
    )
    queue_depth = db.query(func.count(BackgroundJob.id)).filter(BackgroundJob.status == "queued").scalar() or 0

    return {
        "database_reachable": db_ok,
        "queue_depth": queue_depth,
        "recent_error_count_1h": recent_errors,
    }
