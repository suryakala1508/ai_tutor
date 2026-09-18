"""Persistent per-project learning context store + relevance-based selection.

Phase 9 requirement: don't dump the whole context blob into every Tutor/quiz
prompt — pick only what's relevant to the current request, and log what was
included/excluded and why (even a one-line rule is fine).
"""

import re

from sqlalchemy.orm import Session

from app.authorization import get_owned_project
from app.models.models import LearningContext

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {"the", "a", "an", "is", "are", "of", "to", "in", "and", "what", "how", "why", "does", "do"}


def _keywords(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 2}


def get_or_create_context(db: Session, owner_id: str, project_id: str) -> LearningContext:
    get_owned_project(db, project_id, owner_id, raise_http=False)
    ctx = db.query(LearningContext).filter(LearningContext.project_id == project_id).first()
    if ctx is None:
        ctx = LearningContext(project_id=project_id, owner_id=owner_id)
        db.add(ctx)
        db.commit()
        db.refresh(ctx)
    return ctx


def select_learning_context(db: Session, owner_id: str, project_id: str, query: str) -> dict:
    """Returns {"text": <compact prompt block>, "selection_log": [...]}.

    Selection rule (simple, inspectable): a weakness/strength/repeated-mistake
    entry is included only if its concept name shares a keyword with the
    current query, OR it's a repeated_mistake (always surfaced — small list,
    high signal). The goal is always included (small, always relevant).
    """
    ctx = get_or_create_context(db, owner_id, project_id)
    query_kw = _keywords(query)

    included_lines = []
    log = []

    if ctx.goal:
        included_lines.append(f"Learner goal: {ctx.goal}")
        log.append("included: goal (always included, small)")

    for w in ctx.weaknesses or []:
        name = w.get("concept_name", "")
        if _keywords(name) & query_kw:
            included_lines.append(f"Known weak concept relevant to this question: {name} — {w.get('note', '')}")
            log.append(f"included: weak concept '{name}' matches query keywords")
        else:
            log.append(f"excluded: weak concept '{name}' — no keyword overlap with query")

    for m in ctx.repeated_mistakes or []:
        name = m.get("concept_name", "unknown")
        included_lines.append(
            f"Repeated mistake pattern: {name} missed {m.get('count', '?')} times recently."
        )
        log.append(f"included: repeated mistake '{name}' (always surfaced)")

    for s in ctx.strengths or []:
        name = s.get("concept_name", "")
        if _keywords(name) & query_kw:
            included_lines.append(f"Known strength relevant to this question: {name}")
            log.append(f"included: strength '{name}' matches query keywords")

    if not included_lines:
        included_lines.append("(no relevant persistent learner context for this question)")

    return {"text": "\n".join(included_lines), "selection_log": log}
