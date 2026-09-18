from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project, get_owned_space
from app.database import get_db
from app.models.models import (
    AIUsageEvent,
    Concept,
    ConceptMastery,
    LearningEvent,
    Material,
    MasterySnapshot,
    Project,
    QuizAnswer,
    Recommendation,
    Space,
    User,
)

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/spaces/{space_id}/analytics")
def space_analytics(
    space_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    space = get_owned_space(db, space_id, user.id)

    projects = (
        db.query(Project)
        .filter(Project.space_id == space_id, Project.owner_id == user.id)
        .order_by(Project.created_at.desc())
        .all()
    )
    project_ids = [p.id for p in projects]

    recent_activity = []
    if project_ids:
        recent_activity = (
            db.query(LearningEvent)
            .filter(LearningEvent.project_id.in_(project_ids), LearningEvent.owner_id == user.id)
            .order_by(LearningEvent.created_at.desc())
            .limit(20)
            .all()
        )

    mastery_rows = (
        db.query(ConceptMastery)
        .filter(ConceptMastery.project_id.in_(project_ids), ConceptMastery.owner_id == user.id)
        .all()
        if project_ids
        else []
    )
    overall_avg_mastery = (
        round(sum(m.mastery for m in mastery_rows) / len(mastery_rows), 3) if mastery_rows else None
    )

    project_names = {p.id: p.name for p in projects}
    needs_attention = []
    if project_ids:
        needs_attention = (
            db.query(ConceptMastery, Concept)
            .join(Concept, ConceptMastery.concept_id == Concept.id)
            .filter(
                ConceptMastery.project_id.in_(project_ids),
                ConceptMastery.owner_id == user.id,
                ConceptMastery.trend == "needs-attention",
            )
            .limit(10)
            .all()
        )

    return {
        "space": {"id": space.id, "name": space.name, "description": space.description or ""},
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description or "",
                "goal": p.goal or "",
                "created_at": p.created_at.isoformat(),
            }
            for p in projects
        ],
        "recent_activity": [
            {"type": e.type, "project_id": e.project_id, "created_at": e.created_at.isoformat()}
            for e in recent_activity
        ],
        "overall_progress": {
            "average_mastery": overall_avg_mastery,
            "tracked_concepts": len(mastery_rows),
            "project_count": len(projects),
        },
        "areas_requiring_attention": [
            {
                "concept_id": m.concept_id,
                "concept_name": c.name,
                "project_id": m.project_id,
                "project_name": project_names.get(m.project_id, ""),
                "mastery": round(m.mastery, 3),
            }
            for m, c in needs_attention
        ],
    }


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

    all_events = (
        db.query(LearningEvent)
        .filter(LearningEvent.project_id == project_id, LearningEvent.owner_id == user.id)
        .all()
    )
    event_counts = {}
    for e in all_events:
        event_counts[e.type] = event_counts.get(e.type, 0) + 1

    materials_uploaded = db.query(Material).filter(Material.project_id == project_id, Material.owner_id == user.id).count()
    materials_processed = (
        db.query(Material)
        .filter(Material.project_id == project_id, Material.owner_id == user.id, Material.status == "ready")
        .count()
    )
    recommendations_generated = (
        db.query(Recommendation).filter(Recommendation.project_id == project_id, Recommendation.owner_id == user.id).count()
    )

    all_answers = (
        db.query(QuizAnswer).filter(QuizAnswer.project_id == project_id, QuizAnswer.owner_id == user.id).all()
    )
    correct_or_strong = sum(1 for a in all_answers if a.is_correct)
    quiz_accuracy = (correct_or_strong / len(all_answers)) if all_answers else None

    overall_avg_mastery = (
        round(sum(m.mastery for m, _ in mastery_rows) / len(mastery_rows), 3) if mastery_rows else None
    )

    EVENT_DESCRIPTIONS = {
        "material_processed": "Material processed",
        "quiz_answered": "Answered a quiz question",
        "repeated_mistake_detected": "Repeated mistake detected",
        "assessment_completed": "Assessment completed",
        "tutor_conversation": "Tutor conversation",
    }

    return {
        "summary": {
            "total_events": len(all_events),
            "materials_uploaded": materials_uploaded,
            "materials_processed": materials_processed,
            "quiz_questions_answered": event_counts.get("quiz_answered", 0),
            "tutor_messages": event_counts.get("tutor_conversation", 0),
            "assessments_completed": event_counts.get("assessment_completed", 0),
            "recommendations_generated": recommendations_generated,
        },
        "quiz_performance": {
            "total_answers": len(all_answers),
            "correct_or_strong": correct_or_strong,
            "accuracy": round(quiz_accuracy, 3) if quiz_accuracy is not None else None,
        },
        "mastery_summary": {
            "tracked_concepts": len(mastery_rows),
            "average_mastery": overall_avg_mastery,
        },
        "recent_activity": [
            {
                "type": e.type,
                "description": EVENT_DESCRIPTIONS.get(e.type, e.type),
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ],
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


@router.get("/projects/{project_id}/growth")
def project_growth(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    mastery_rows = (
        db.query(ConceptMastery, Concept)
        .join(Concept, ConceptMastery.concept_id == Concept.id)
        .filter(ConceptMastery.project_id == project_id, ConceptMastery.owner_id == user.id)
        .all()
    )

    STATUS_LABELS = {"needs-attention": "Needs attention", "improving": "Improving", "stable": "Stable"}

    concepts = []
    improving = stable = requiring_attention = 0
    for m, c in mastery_rows:
        prev_snapshot = (
            db.query(MasterySnapshot)
            .filter(MasterySnapshot.project_id == project_id, MasterySnapshot.concept_id == c.id)
            .order_by(MasterySnapshot.created_at.desc())
            .offset(1)
            .first()
        )
        last_snapshot = (
            db.query(MasterySnapshot)
            .filter(MasterySnapshot.project_id == project_id, MasterySnapshot.concept_id == c.id)
            .order_by(MasterySnapshot.created_at.desc())
            .first()
        )
        previous_mastery = round(prev_snapshot.mastery, 3) if prev_snapshot else None
        change = round(m.mastery - previous_mastery, 3) if previous_mastery is not None else None

        if m.trend == "needs-attention":
            requiring_attention += 1
        elif m.trend == "improving":
            improving += 1
        else:
            stable += 1

        concepts.append(
            {
                "concept_id": c.id,
                "concept_name": c.name,
                "current_mastery": round(m.mastery, 3),
                "previous_mastery": previous_mastery,
                "change": change,
                "status": m.trend,
                "status_label": STATUS_LABELS.get(m.trend, m.trend),
                "attempts": m.attempts,
                "last_practiced_at": last_snapshot.created_at.isoformat() if last_snapshot else None,
            }
        )

    average_mastery = round(sum(m.mastery for m, _ in mastery_rows) / len(mastery_rows), 3) if mastery_rows else None

    return {
        "summary": {
            "tracked_concepts": len(mastery_rows),
            "improving": improving,
            "stable": stable,
            "requiring_attention": requiring_attention,
            "average_mastery": average_mastery,
        },
        "concepts": concepts,
    }


@router.get("/projects/{project_id}/recommendations")
def project_recommendations(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    mastery_rows = (
        db.query(ConceptMastery, Concept)
        .join(Concept, ConceptMastery.concept_id == Concept.id)
        .filter(ConceptMastery.project_id == project_id, ConceptMastery.owner_id == user.id)
        .all()
    )

    if not mastery_rows:
        return {
            "insufficient_data": True,
            "message": "Answer a few quiz questions to get personalized recommendations.",
            "recommendations": [],
        }

    items = []
    for m, c in mastery_rows:
        if m.trend == "needs-attention":
            items.append(
                {
                    "title": f"Review {c.name}",
                    "reason": f"Recent answers show weak understanding of {c.name} (mastery {round(m.mastery * 100)}%).",
                    "suggested_action": f"Ask the Tutor to re-explain {c.name}, then retry a quiz on it.",
                    "action_type": "use_tutor",
                    "concept_id": c.id,
                    "concept_name": c.name,
                    "priority": "high",
                    "priority_score": 1.0 - m.mastery,
                }
            )
        elif m.mastery < 0.5:
            items.append(
                {
                    "title": f"Practice {c.name}",
                    "reason": f"Mastery of {c.name} is still developing ({round(m.mastery * 100)}%).",
                    "suggested_action": f"Take a quiz focused on {c.name} to build confidence.",
                    "action_type": "take_quiz",
                    "concept_id": c.id,
                    "concept_name": c.name,
                    "priority": "medium",
                    "priority_score": 0.5 - m.mastery + 0.5,
                }
            )

    latest_llm_rec = (
        db.query(Recommendation)
        .filter(Recommendation.project_id == project_id, Recommendation.owner_id == user.id)
        .order_by(Recommendation.created_at.desc())
        .first()
    )
    if latest_llm_rec:
        concept = next((c for _, c in mastery_rows if c.id == latest_llm_rec.concept_id), None)
        items.insert(
            0,
            {
                "title": "Recommended next step",
                "reason": latest_llm_rec.action_text,
                "suggested_action": latest_llm_rec.action_text,
                "action_type": "use_tutor",
                "concept_id": latest_llm_rec.concept_id,
                "concept_name": concept.name if concept else None,
                "priority": "high",
                "priority_score": 1.0,
            },
        )

    items.sort(key=lambda i: i["priority_score"], reverse=True)

    if not items:
        return {
            "insufficient_data": False,
            "message": "You're doing well across all tracked concepts — no urgent action needed.",
            "recommendations": [],
        }

    return {"insufficient_data": False, "message": None, "recommendations": items[:5]}


@router.get("/analytics/global")
def global_analytics(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    spaces = db.query(Space).filter(Space.owner_id == user.id).all()
    projects = db.query(Project).filter(Project.owner_id == user.id).all()
    project_ids = [p.id for p in projects]

    all_events = db.query(LearningEvent).filter(LearningEvent.owner_id == user.id).all()
    event_counts: dict[str, int] = {}
    for e in all_events:
        event_counts[e.type] = event_counts.get(e.type, 0) + 1

    materials_uploaded = db.query(Material).filter(Material.owner_id == user.id).count()
    materials_processed = db.query(Material).filter(Material.owner_id == user.id, Material.status == "ready").count()
    recommendations_generated = db.query(Recommendation).filter(Recommendation.owner_id == user.id).count()

    all_answers = db.query(QuizAnswer).filter(QuizAnswer.owner_id == user.id).all()
    correct_or_strong = sum(1 for a in all_answers if a.is_correct)
    quiz_accuracy = (correct_or_strong / len(all_answers)) if all_answers else None

    mastery_rows = db.query(ConceptMastery).filter(ConceptMastery.owner_id == user.id).all()
    average_mastery = round(sum(m.mastery for m in mastery_rows) / len(mastery_rows), 3) if mastery_rows else None

    trend_counts = {"improving": 0, "stable": 0, "needs-attention": 0}
    for m in mastery_rows:
        trend_counts[m.trend] = trend_counts.get(m.trend, 0) + 1

    ai_agg = (
        db.query(
            AIUsageEvent.feature,
            func.count(AIUsageEvent.id).label("calls"),
            func.sum(AIUsageEvent.prompt_tokens).label("prompt_tokens"),
            func.sum(AIUsageEvent.completion_tokens).label("completion_tokens"),
        )
        .filter(AIUsageEvent.owner_id == user.id)
        .group_by(AIUsageEvent.feature)
        .all()
    )

    EVENT_DESCRIPTIONS = {
        "material_processed": "Material processed",
        "quiz_answered": "Answered a quiz question",
        "repeated_mistake_detected": "Repeated mistake detected",
        "assessment_completed": "Assessment completed",
        "tutor_conversation": "Tutor conversation",
    }
    recent_events = sorted(all_events, key=lambda e: e.created_at, reverse=True)[:20]

    space_names = {s.id: s.name for s in spaces}
    projects_overview = []
    for p in projects:
        p_mastery = [m for m in mastery_rows if m.project_id == p.id]
        p_answers = [a for a in all_answers if a.project_id == p.id]
        p_events = [e for e in all_events if e.project_id == p.id]
        p_accuracy = (sum(1 for a in p_answers if a.is_correct) / len(p_answers)) if p_answers else None
        projects_overview.append(
            {
                "project_id": p.id,
                "project_name": p.name,
                "space_name": space_names.get(p.space_id, ""),
                "tracked_concepts": len(p_mastery),
                "average_mastery": round(sum(m.mastery for m in p_mastery) / len(p_mastery), 3) if p_mastery else None,
                "quiz_accuracy": round(p_accuracy, 3) if p_accuracy is not None else None,
                "total_events": len(p_events),
            }
        )

    return {
        "totals": {"total_spaces": len(spaces), "total_projects": len(projects)},
        "summary": {
            "total_events": len(all_events),
            "materials_uploaded": materials_uploaded,
            "materials_processed": materials_processed,
            "quiz_questions_answered": event_counts.get("quiz_answered", 0),
            "tutor_messages": event_counts.get("tutor_conversation", 0),
            "assessments_completed": event_counts.get("assessment_completed", 0),
            "recommendations_generated": recommendations_generated,
        },
        "quiz_performance": {
            "total_answers": len(all_answers),
            "correct_or_strong": correct_or_strong,
            "accuracy": round(quiz_accuracy, 3) if quiz_accuracy is not None else None,
        },
        "mastery_summary": {
            "tracked_concepts": len(mastery_rows),
            "average_mastery": average_mastery,
        },
        "concept_trends": {
            "improving": trend_counts.get("improving", 0),
            "stable": trend_counts.get("stable", 0),
            "requiring_attention": trend_counts.get("needs-attention", 0),
            "insufficient_data": max(len(project_ids) - len(mastery_rows), 0) if not mastery_rows else 0,
        },
        "recent_activity": [
            {
                "type": e.type,
                "description": EVENT_DESCRIPTIONS.get(e.type, e.type),
                "created_at": e.created_at.isoformat(),
            }
            for e in recent_events
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
        "projects_overview": projects_overview,
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

    spaces = (
        db.query(Space)
        .filter(Space.owner_id == user.id)
        .order_by(Space.created_at.desc())
        .all()
    )
    project_counts = dict(
        db.query(Project.space_id, func.count(Project.id))
        .filter(Project.owner_id == user.id)
        .group_by(Project.space_id)
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

    space_names = {s.id: s.name for s in spaces}

    return {
        "recent_projects": [
            {
                "id": p.id,
                "name": p.name,
                "space_id": p.space_id,
                "space_name": space_names.get(p.space_id, ""),
            }
            for p in recent_projects
        ],
        "spaces": [
            {
                "id": s.id,
                "name": s.name,
                "description": s.description or "",
                "project_count": project_counts.get(s.id, 0),
            }
            for s in spaces
        ],
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
