"""Explicit, inspectable scoring function for picking the next quiz
concept + difficulty.

NOT a simple "wrong -> easier, right -> harder" rule, because single-answer
correctness alone is a weak signal: a concept can be individually easy but
under-practiced (staleness), or a user can get lucky on a hard question
without solid understanding (which mastery, tracked across attempts, already
accounts for better than the last answer alone).

score = low_mastery * 0.4 + staleness * 0.3 + recent_mistake_flag * 0.3

- low_mastery:        (1 - mastery), so weaker concepts float to the top.
- staleness:           days since last practiced, normalized to [0, 1] via a
                        14-day cap — a concept not touched in 2+ weeks is
                        "fully stale" even if mastery is decent, so it still
                        surfaces (spaced-practice pressure).
- recent_mistake_flag: 1.0 if this concept appears in recent wrong/weak
                        answers, else 0.0 — a direct, recency-weighted signal
                        separate from the aggregate mastery number.

Difficulty is picked from mastery directly (not from the score): low mastery
-> easy, mid -> medium, high -> hard, so we don't ask a hard question about a
concept the learner is still building basics on.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.models import Concept, ConceptMastery

STALENESS_CAP_DAYS = 14.0

WEIGHT_LOW_MASTERY = 0.4
WEIGHT_STALENESS = 0.3
WEIGHT_RECENT_MISTAKE = 0.3


def _staleness(last_practiced_at: datetime | None, now: datetime) -> float:
    if last_practiced_at is None:
        return 1.0  # never practiced = maximally stale
    if last_practiced_at.tzinfo is None:
        last_practiced_at = last_practiced_at.replace(tzinfo=timezone.utc)
    days = (now - last_practiced_at).total_seconds() / 86400
    return max(0.0, min(1.0, days / STALENESS_CAP_DAYS))


def _difficulty_for_mastery(mastery: float) -> str:
    if mastery < 0.4:
        return "easy"
    if mastery < 0.75:
        return "medium"
    return "hard"


def select_next_concept(
    db: Session, project_id: str, owner_id: str, recent_mistake_concept_ids: set[str]
) -> dict | None:
    rows = (
        db.query(Concept, ConceptMastery)
        .outerjoin(
            ConceptMastery,
            (ConceptMastery.concept_id == Concept.id) & (ConceptMastery.project_id == project_id),
        )
        .filter(Concept.project_id == project_id, Concept.owner_id == owner_id)
        .all()
    )
    if not rows:
        return None

    now = datetime.now(timezone.utc)
    scored = []
    for concept, mastery_row in rows:
        mastery_value = mastery_row.mastery if mastery_row else 0.3
        last_practiced = mastery_row.last_practiced_at if mastery_row else None

        low_mastery = 1 - mastery_value
        staleness = _staleness(last_practiced, now)
        recent_mistake_flag = 1.0 if concept.id in recent_mistake_concept_ids else 0.0

        score = (
            WEIGHT_LOW_MASTERY * low_mastery
            + WEIGHT_STALENESS * staleness
            + WEIGHT_RECENT_MISTAKE * recent_mistake_flag
        )

        scored.append(
            {
                "concept_id": concept.id,
                "concept_name": concept.name,
                "difficulty": _difficulty_for_mastery(mastery_value),
                "score": round(score, 4),
                "reasons": {
                    "mastery": round(mastery_value, 3),
                    "low_mastery_component": round(WEIGHT_LOW_MASTERY * low_mastery, 4),
                    "staleness_days_component": round(WEIGHT_STALENESS * staleness, 4),
                    "recent_mistake_component": round(WEIGHT_RECENT_MISTAKE * recent_mistake_flag, 4),
                },
            }
        )

    scored.sort(key=lambda s: s["score"], reverse=True)
    return scored[0]
