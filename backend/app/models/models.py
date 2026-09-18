import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


def gen_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=now_utc)

    spaces = relationship("Space", back_populates="owner", cascade="all, delete-orphan")


class Space(Base):
    __tablename__ = "spaces"

    id = Column(String, primary_key=True, default=gen_id)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=now_utc)

    owner = relationship("User", back_populates="spaces")
    projects = relationship("Project", back_populates="space", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=gen_id)
    space_id = Column(String, ForeignKey("spaces.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    goal = Column(Text, default="")
    created_at = Column(DateTime, default=now_utc)

    space = relationship("Space", back_populates="projects")
    materials = relationship("Material", back_populates="project", cascade="all, delete-orphan")
    concepts = relationship("Concept", back_populates="project", cascade="all, delete-orphan")


class Material(Base):
    __tablename__ = "materials"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String, default="pending")  # pending, processing, ready, failed
    error_message = Column(Text, nullable=True)
    raw_text = Column(Text, default="")
    page_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=now_utc)
    processed_at = Column(DateTime, nullable=True)

    project = relationship("Project", back_populates="materials")
    chunks = relationship("Chunk", back_populates="material", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(String, primary_key=True, default=gen_id)
    material_id = Column(String, ForeignKey("materials.id"), nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    page_number = Column(Integer, default=1)
    chunk_index = Column(Integer, default=0)
    text = Column(Text, nullable=False)
    embedding = Column(JSON, nullable=True)  # list[float], stored as JSON for sqlite portability

    material = relationship("Material", back_populates="chunks")


class Concept(Base):
    __tablename__ = "concepts"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_concept_project_name"),)

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    created_at = Column(DateTime, default=now_utc)

    project = relationship("Project", back_populates="concepts")


class ConceptMastery(Base):
    """Current mastery state (one row per project+concept, updated in place)."""

    __tablename__ = "concept_mastery"
    __table_args__ = (UniqueConstraint("project_id", "concept_id", name="uq_mastery_project_concept"),)

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    mastery = Column(Float, default=0.3)  # 0..1
    attempts = Column(Integer, default=0)
    correct = Column(Integer, default=0)
    last_practiced_at = Column(DateTime, nullable=True)
    trend = Column(String, default="stable")  # improving, stable, needs-attention
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)


class MasterySnapshot(Base):
    """Append-only history so Growth charts have real data over time."""

    __tablename__ = "mastery_snapshots"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    mastery = Column(Float, nullable=False)
    trend = Column(String, default="stable")
    created_at = Column(DateTime, default=now_utc, index=True)


class LearningEvent(Base):
    """Central event log. event_id (client-supplied idempotency key) is unique."""

    __tablename__ = "learning_events"

    id = Column(String, primary_key=True, default=gen_id)
    event_id = Column(String, unique=True, index=True, nullable=False)  # idempotency key
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String, nullable=False, index=True)  # quiz_answered, material_processed, tutor_conversation, assessment_completed
    payload = Column(JSON, default=dict)
    processed = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=now_utc, index=True)


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    conversation_id = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)  # user, assistant, system
    content = Column(Text, nullable=False)
    citations = Column(JSON, default=list)
    retrieval_ids_used = Column(JSON, default=list)
    insufficient_evidence = Column(Boolean, default=False)
    model = Column(String, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=now_utc, index=True)


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    difficulty = Column(String, default="medium")  # easy, medium, hard
    kind = Column(String, default="mcq")  # mcq, open_ended
    question_text = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)  # list[str] for mcq
    correct_answer = Column(String, nullable=True)  # mcq correct option
    expected_key_points = Column(JSON, nullable=True)  # list[str] for open_ended
    source_chunk_ids = Column(JSON, default=list)
    selection_score = Column(Float, nullable=True)
    selection_reasons = Column(JSON, default=dict)
    created_at = Column(DateTime, default=now_utc)


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"

    id = Column(String, primary_key=True, default=gen_id)
    question_id = Column(String, ForeignKey("quiz_questions.id"), nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    answer_text = Column(Text, nullable=False)
    is_correct = Column(Boolean, nullable=True)  # mcq: bool; open_ended: derived from understanding_level
    understanding_level = Column(String, nullable=True)  # strong, partial, weak (open_ended)
    concepts_covered = Column(JSON, default=list)
    concepts_missing = Column(JSON, default=list)
    grading_explanation = Column(Text, nullable=True)
    raw_evaluation = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=now_utc)


class LearningContext(Base):
    """Persistent per-project learning context, updated incrementally from events."""

    __tablename__ = "learning_context"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), unique=True, nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    goal = Column(Text, default="")
    strengths = Column(JSON, default=list)  # list[{concept_id, concept_name, note}]
    weaknesses = Column(JSON, default=list)
    repeated_mistakes = Column(JSON, default=list)  # list[{concept_id, count, last_seen}]
    important_tutor_context = Column(JSON, default=list)  # list[str]
    assessment_history_summary = Column(Text, default="")
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True)
    action_text = Column(Text, nullable=False)
    driving_event_ids = Column(JSON, default=list)
    created_at = Column(DateTime, default=now_utc, index=True)


class AIUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id = Column(String, primary_key=True, default=gen_id)
    project_id = Column(String, ForeignKey("projects.id"), nullable=True, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    feature = Column(String, nullable=False, index=True)  # tutor, quiz_generation, grading, recommendation, tool_call
    model = Column(String, nullable=True)
    tool_name = Column(String, nullable=True)
    tool_input = Column(JSON, nullable=True)
    tool_outcome = Column(String, nullable=True)  # success, error, rejected_invalid
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    success = Column(Boolean, default=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now_utc, index=True)


class BackgroundJob(Base):
    __tablename__ = "background_jobs"

    id = Column(String, primary_key=True, default=gen_id)
    job_type = Column(String, nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=True, index=True)
    owner_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    status = Column(String, default="queued", index=True)  # queued, running, succeeded, failed
    payload = Column(JSON, default=dict)
    error_message = Column(Text, nullable=True)
    attempts = Column(Integer, default=0)
    idempotency_key = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=now_utc, index=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(String, primary_key=True, default=gen_id)
    suite = Column(String, nullable=False, index=True)  # tutor_groundedness, assessment_grading
    passed = Column(Integer, default=0)
    failed = Column(Integer, default=0)
    details = Column(JSON, default=list)
    created_at = Column(DateTime, default=now_utc, index=True)
