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
    Material,
    Project,
    QuizAnswer,
    Space,
    User,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/overview")
def overview(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_spaces = db.query(func.count(Space.id)).scalar() or 0
    total_projects = db.query(func.count(Project.id)).scalar() or 0
    total_materials = db.query(func.count(Material.id)).scalar() or 0

    materials_by_status = {"queued": 0, "processing": 0, "ready": 0, "failed": 0}
    for status, count in db.query(Material.status, func.count(Material.id)).group_by(Material.status).all():
        key = "queued" if status == "pending" else status
        if key in materials_by_status:
            materials_by_status[key] = count

    quiz_answers_total = db.query(func.count(QuizAnswer.id)).scalar() or 0
    assessments_completed_total = (
        db.query(func.count(LearningEvent.id)).filter(LearningEvent.type == "assessment_completed").scalar() or 0
    )
    tutor_messages_total = (
        db.query(func.count(LearningEvent.id)).filter(LearningEvent.type == "tutor_conversation").scalar() or 0
    )

    return {
        "total_users": total_users,
        "total_spaces": total_spaces,
        "total_projects": total_projects,
        "total_materials": total_materials,
        "materials_by_status": materials_by_status,
        "quiz_answers_total": quiz_answers_total,
        "assessments_completed_total": assessments_completed_total,
        "tutor_messages_total": tutor_messages_total,
    }


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

    failed_ai_events = (
        db.query(AIUsageEvent)
        .filter(AIUsageEvent.created_at >= since, AIUsageEvent.success.is_(False))
        .order_by(AIUsageEvent.created_at.desc())
        .limit(10)
        .all()
    )
    failed_jobs = (
        db.query(BackgroundJob)
        .filter(BackgroundJob.status == "failed", BackgroundJob.finished_at >= since)
        .order_by(BackgroundJob.finished_at.desc())
        .limit(10)
        .all()
    )
    recent_failures = sorted(
        [
            {
                "source": "ai_usage",
                "label": e.feature,
                "error_message": e.error_message,
                "created_at": e.created_at.isoformat(),
            }
            for e in failed_ai_events
        ]
        + [
            {
                "source": "background_job",
                "label": j.job_type,
                "error_message": j.error_message,
                "created_at": (j.finished_at or j.created_at).isoformat(),
            }
            for j in failed_jobs
        ],
        key=lambda f: f["created_at"],
        reverse=True,
    )[:10]

    return {
        "database_reachable": db_ok,
        "queue_depth": queue_depth,
        "recent_error_count_1h": recent_errors,
        "recent_failures": recent_failures,
    }
