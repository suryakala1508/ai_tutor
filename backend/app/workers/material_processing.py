from datetime import datetime, timezone

from app.database import SessionLocal
from app.models.models import Chunk, Material
from app.services.concept_extraction import extract_and_store_concepts
from app.services.embeddings import embed
from app.services.retrieval import chunk_text
from app.workers.event_writer import write_learning_event
from app.workers.job_queue import register_handler


@register_handler("process_material")
async def process_material(payload: dict) -> None:
    material_id = payload["material_id"]
    db = SessionLocal()
    try:
        material = db.query(Material).filter(Material.id == material_id).first()
        if not material:
            return
        material.status = "processing"
        db.commit()

        try:
            pages = material.raw_text.split("\f") if material.raw_text else [""]
            chunk_index = 0
            for page_num, page_text in enumerate(pages, start=1):
                for piece in chunk_text(page_text, page_num):
                    chunk = Chunk(
                        material_id=material.id,
                        project_id=material.project_id,
                        owner_id=material.owner_id,
                        page_number=page_num,
                        chunk_index=chunk_index,
                        text=piece,
                        embedding=embed(piece),
                    )
                    db.add(chunk)
                    chunk_index += 1

            material.page_count = len(pages)
            material.status = "ready"
            material.processed_at = datetime.now(timezone.utc)
            db.commit()
        except Exception as exc:  # noqa: BLE001
            material.status = "failed"
            material.error_message = str(exc)
            db.commit()
            raise

        # Concept extraction is best-effort: a material with good chunks/embeddings
        # is still "ready" and usable by the Tutor even if concept extraction fails
        # (e.g. LLM provider unavailable). Never flip a ready material back to failed.
        try:
            await extract_and_store_concepts(db, material.project_id, material.owner_id, material.raw_text)
        except Exception:  # noqa: BLE001
            pass

        write_learning_event(
            db,
            project_id=material.project_id,
            owner_id=material.owner_id,
            event_type="material_processed",
            payload={"material_id": material.id, "chunk_count": chunk_index},
            event_id=f"material_processed:{material.id}",
        )
    finally:
        db.close()
