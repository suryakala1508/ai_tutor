"""retrieveContext(): chunk-level retrieval scoped to a single Project.

This is the ONE function that reads chunk embeddings. The AI tool layer
(app.tools.search_materials) wraps this with authorization + logging; the
Tutor and quiz generator must never call this directly (Phase 6 requirement).
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.models import Chunk, Material
from app.services.embeddings import cosine_similarity, embed

settings = get_settings()


@dataclass
class RetrievedChunk:
    chunk_id: str
    material_id: str
    material_name: str
    page_number: int
    text: str
    score: float


def chunk_text(text: str, page_number: int, chunk_size: int = 800, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - overlap
    return chunks


def retrieve_context(
    db: Session,
    project_id: str,
    query: str,
    top_k: int | None = None,
    min_score: float | None = None,
) -> tuple[list[RetrievedChunk], bool]:
    """Returns (chunks, insufficient_evidence).

    insufficient_evidence is True when nothing clears min_score — the caller
    (Tutor) must surface this explicitly instead of answering confidently.
    """
    top_k = top_k or settings.retrieval_top_k
    min_score = min_score if min_score is not None else settings.retrieval_min_score

    query_vec = embed(query)
    rows = (
        db.query(Chunk, Material)
        .join(Material, Chunk.material_id == Material.id)
        .filter(Chunk.project_id == project_id, Material.status == "ready")
        .all()
    )

    scored: list[RetrievedChunk] = []
    for chunk, material in rows:
        if not chunk.embedding:
            continue
        score = cosine_similarity(query_vec, chunk.embedding)
        scored.append(
            RetrievedChunk(
                chunk_id=chunk.id,
                material_id=material.id,
                material_name=material.name,
                page_number=chunk.page_number,
                text=chunk.text,
                score=score,
            )
        )

    scored.sort(key=lambda c: c.score, reverse=True)
    top = scored[:top_k]
    passing = [c for c in top if c.score >= min_score]
    insufficient_evidence = len(passing) == 0
    return (top if top else []), insufficient_evidence
