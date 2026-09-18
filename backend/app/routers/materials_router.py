from fastapi import APIRouter, Depends, HTTPException, UploadFile

from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.authorization import get_owned_project
from app.database import get_db
from app.models.models import Material, User
from app.schemas.schemas import MaterialOut
from app.workers.job_queue import enqueue_job

router = APIRouter(prefix="/api/projects/{project_id}/materials", tags=["materials"])

ALLOWED_CONTENT_TYPES = {"application/pdf", "text/plain"}
MAX_FILE_BYTES = 20 * 1024 * 1024


def _extract_text(filename: str, content_type: str, data: bytes) -> str:
    if content_type == "text/plain" or filename.lower().endswith(".txt"):
        return data.decode("utf-8", errors="replace")

    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        try:
            from io import BytesIO

            from pypdf import PdfReader

            reader = PdfReader(BytesIO(data))
            pages = []
            for page in reader.pages:
                extracted = page.extract_text() or ""
                pages.append(extracted)
            # Note: scanned/image-only PDFs yield empty text here — OCR is out
            # of scope (documented in LIMITATIONS.md). Only text-layer PDFs work.
            return "\f".join(pages)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"Could not parse PDF: {exc}")

    raise HTTPException(status_code=415, detail="Unsupported file type. Use PDF or plain text.")


@router.post("", response_model=MaterialOut)
async def upload_material(
    project_id: str,
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)

    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20MB)")
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    raw_text = _extract_text(file.filename or "upload", file.content_type or "", data)

    material = Material(
        project_id=project_id,
        owner_id=user.id,
        name=file.filename or "Untitled material",
        status="pending",
        raw_text=raw_text,
    )
    db.add(material)
    db.commit()
    db.refresh(material)

    enqueue_job(
        "process_material",
        {"material_id": material.id},
        project_id=project_id,
        owner_id=user.id,
        idempotency_key=f"process_material:{material.id}",
    )

    return material


@router.get("", response_model=list[MaterialOut])
def list_materials(
    project_id: str,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    limit = min(max(limit, 1), 100)
    return (
        db.query(Material)
        .filter(Material.project_id == project_id, Material.owner_id == user.id)
        .order_by(Material.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/{material_id}", response_model=MaterialOut)
def get_material(
    project_id: str,
    material_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    material = (
        db.query(Material)
        .filter(Material.id == material_id, Material.project_id == project_id, Material.owner_id == user.id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    return material


@router.post("/{material_id}/retry", response_model=MaterialOut)
async def retry_material(
    project_id: str,
    material_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    material = (
        db.query(Material)
        .filter(Material.id == material_id, Material.project_id == project_id, Material.owner_id == user.id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    material.status = "pending"
    material.processing_stage = None
    material.error_message = None
    db.commit()
    db.refresh(material)

    enqueue_job(
        "process_material",
        {"material_id": material.id},
        project_id=project_id,
        owner_id=user.id,
    )

    return material


@router.delete("/{material_id}")
def delete_material(
    project_id: str,
    material_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    get_owned_project(db, project_id, user.id)
    material = (
        db.query(Material)
        .filter(Material.id == material_id, Material.project_id == project_id, Material.owner_id == user.id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    db.delete(material)
    db.commit()
    return {"deleted": True}
