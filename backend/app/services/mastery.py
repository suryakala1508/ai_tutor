"""Mastery update: exponentially-decayed running average.

new_mastery = old_mastery * (1 - alpha) + observation * alpha

- observation is 1.0 for a correct MCQ / "strong" open-ended answer, 0.5 for
  "partial", 0.0 for incorrect/"weak". This makes partial credit meaningful
  instead of binary right/wrong.
- alpha = 0.3: recent answers move the estimate meaningfully (so genuine
  improvement/decline shows up within a few attempts) without one lucky or
  unlucky answer swinging it drastically (alpha=1.0 would just be "mastery =
  last answer", which is exactly the weak signal the PRD calls out).
- Every update also appends a MasterySnapshot row (append-only) so Growth
  charts have real history instead of only the current value.

Trend classification (improving / stable / needs-attention) compares the
average of the last 3 snapshots to the average of the 3 before that:
  improving      if recent_avg - prior_avg > 0.05
  needs-attention if recent_avg - prior_avg < -0.05, OR 2+ of the last 3
                   answers were wrong/weak (repeated-mistake signal)
  stable          otherwise
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.models import ConceptMastery, MasterySnapshot, QuizAnswer

ALPHA = 0.3


def _observation_value(is_correct: bool | None, understanding_level: str | None) -> float:
    if understanding_level == "strong":
        return 1.0
    if understanding_level == "partial":
        return 0.5
    if understanding_level == "weak":
        return 0.0
    return 1.0 if is_correct else 0.0


def update_mastery(
    db: Session,
    project_id: str,
    owner_id: str,
    concept_id: str,
    is_correct: bool | None,
    understanding_level: str | None,
) -> ConceptMastery:
    row = (
        db.query(ConceptMastery)
        .filter(ConceptMastery.project_id == project_id, ConceptMastery.concept_id == concept_id)
        .first()
    )
    if row is None:
        row = ConceptMastery(project_id=project_id, owner_id=owner_id, concept_id=concept_id, mastery=0.3)
        db.add(row)
        db.flush()

    observation = _observation_value(is_correct, understanding_level)
    row.mastery = row.mastery * (1 - ALPHA) + observation * ALPHA
    row.mastery = max(0.0, min(1.0, row.mastery))
    row.attempts += 1
    if is_correct or understanding_level == "strong":
        row.correct += 1
    row.last_practiced_at = datetime.now(timezone.utc)

    row.trend = classify_trend(db, project_id, concept_id)

    db.add(
        MasterySnapshot(
            project_id=project_id,
            owner_id=owner_id,
            concept_id=concept_id,
            mastery=row.mastery,
            trend=row.trend,
        )
    )
    db.commit()
    db.refresh(row)
    return row


def classify_trend(db: Session, project_id: str, concept_id: str) -> str:
    snapshots = (
        db.query(MasterySnapshot)
        .filter(MasterySnapshot.project_id == project_id, MasterySnapshot.concept_id == concept_id)
        .order_by(MasterySnapshot.created_at.desc())
        .limit(6)
        .all()
    )
    recent_answers = (
        db.query(QuizAnswer)
        .filter(QuizAnswer.project_id == project_id, QuizAnswer.concept_id == concept_id)
        .order_by(QuizAnswer.created_at.desc())
        .limit(3)
        .all()
    )
    wrong_count = sum(
        1 for a in recent_answers if a.is_correct is False or a.understanding_level == "weak"
    )
    if wrong_count >= 2:
        return "needs-attention"

    if len(snapshots) < 2:
        return "stable"

    values = [s.mastery for s in snapshots]
    recent = values[:3]
    prior = values[3:6] or recent

    recent_avg = sum(recent) / len(recent)
    prior_avg = sum(prior) / len(prior)
    delta = recent_avg - prior_avg

    if delta < -0.05:
        return "needs-attention"
    if delta > 0.05:
        return "improving"
    return "stable"


def detect_repeated_mistake(db: Session, project_id: str, concept_id: str, threshold: int = 2) -> bool:
    recent_answers = (
        db.query(QuizAnswer)
        .filter(QuizAnswer.project_id == project_id, QuizAnswer.concept_id == concept_id)
        .order_by(QuizAnswer.created_at.desc())
        .limit(5)
        .all()
    )
    wrong_count = sum(
        1 for a in recent_answers if a.is_correct is False or a.understanding_level == "weak"
    )
    return wrong_count >= threshold
