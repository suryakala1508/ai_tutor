import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.database import Base, engine
from app.rate_limit import limiter

# Import workers so their @register_handler decorators run.
from app.workers import job_queue  # noqa: F401
from app.workers import material_processing  # noqa: F401
from app.workers import learning_pipeline  # noqa: F401

from app.routers import (
    admin_router,
    analytics_router,
    auth_router,
    concepts_router,
    flashcards_router,
    materials_router,
    projects_router,
    quiz_router,
    spaces_router,
    tutor_router,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai_tutor")

Base.metadata.create_all(bind=engine)

app = FastAPI(title="AI Tutor API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "https://ai-tutor-frontend.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Never leak a raw stack trace to the client."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our end. Please try again."},
    )


app.include_router(auth_router.router)
app.include_router(spaces_router.router)
app.include_router(projects_router.router)
app.include_router(materials_router.router)
app.include_router(concepts_router.router)
app.include_router(flashcards_router.router)
app.include_router(tutor_router.router)
app.include_router(quiz_router.router)
app.include_router(analytics_router.router)
app.include_router(admin_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
