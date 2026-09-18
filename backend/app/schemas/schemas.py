from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth ----------

class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)

    model_config = ConfigDict(extra="forbid")


class LoginRequest(BaseModel):
    email: str
    password: str

    model_config = ConfigDict(extra="forbid")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    is_admin: bool


# ---------- Space / Project ----------

class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)

    model_config = ConfigDict(extra="forbid")


class SpaceOut(ORMBase):
    id: str
    name: str
    description: str
    created_at: datetime


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    goal: str = Field(default="", max_length=2000)

    model_config = ConfigDict(extra="forbid")


class ProjectOut(ORMBase):
    id: str
    space_id: str
    name: str
    goal: str
    created_at: datetime


class MaterialOut(ORMBase):
    id: str
    project_id: str
    name: str
    status: str
    error_message: Optional[str] = None
    page_count: int
    created_at: datetime
    processed_at: Optional[datetime] = None


# ---------- Tutor ----------

class TutorMessageRequest(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=8000)

    model_config = ConfigDict(extra="forbid")


class Citation(BaseModel):
    source_material: str
    page_number: Optional[int] = None
    chunk_id: str


class TutorMessageResponse(BaseModel):
    conversation_id: str
    role: str = "assistant"
    content: str
    citations: list[Citation]
    insufficient_evidence: bool
    model: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int


class ConversationMessageOut(ORMBase):
    id: str
    conversation_id: str
    role: str
    content: str
    citations: list
    insufficient_evidence: bool
    model: Optional[str] = None
    latency_ms: Optional[int] = None
    created_at: datetime


# ---------- Quiz ----------

class QuizGenerateRequest(BaseModel):
    concept_id: Optional[str] = None  # if omitted, adaptive selection picks it

    model_config = ConfigDict(extra="forbid")


class QuizQuestionOut(ORMBase):
    id: str
    concept_id: str
    difficulty: str
    kind: str
    question_text: str
    options: Optional[list[str]] = None
    selection_score: Optional[float] = None
    selection_reasons: Optional[dict] = None


class QuizAnswerSubmit(BaseModel):
    question_id: str = Field(min_length=1)
    answer_text: str = Field(min_length=1, max_length=4000)

    model_config = ConfigDict(extra="forbid")


class QuizAnswerResult(BaseModel):
    id: str
    is_correct: Optional[bool] = None
    understanding_level: Optional[str] = None
    concepts_covered: list[str] = []
    concepts_missing: list[str] = []
    grading_explanation: Optional[str] = None
    correct_answer: Optional[str] = None


# ---------- Structured LLM outputs ----------

class MCQGenerated(BaseModel):
    question: str
    options: list[str] = Field(min_length=3, max_length=6)
    correct_answer: str

    model_config = ConfigDict(extra="forbid")


class OpenEndedGenerated(BaseModel):
    question: str
    expected_key_points: list[str] = Field(min_length=1, max_length=8)

    model_config = ConfigDict(extra="forbid")


class GradingResult(BaseModel):
    understanding_level: Literal["strong", "partial", "weak"]
    concepts_covered: list[str]
    concepts_missing: list[str]
    explanation: str

    model_config = ConfigDict(extra="forbid")


class RecommendationGenerated(BaseModel):
    concept_name: Optional[str] = None
    action_text: str

    model_config = ConfigDict(extra="forbid")


# ---------- Tool layer ----------

class SearchMaterialsInput(BaseModel):
    project_id: str
    query: str = Field(min_length=1, max_length=2000)

    model_config = ConfigDict(extra="forbid")


class GetMasteryInput(BaseModel):
    project_id: str

    model_config = ConfigDict(extra="forbid")


class GetRecentMistakesInput(BaseModel):
    project_id: str
    limit: int = Field(default=10, ge=1, le=50)

    model_config = ConfigDict(extra="forbid")


class RecordLearningEventInput(BaseModel):
    project_id: str
    type: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict)
    event_id: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


class GenerateQuizQuestionInput(BaseModel):
    project_id: str
    concept: str = Field(min_length=1, max_length=300)
    difficulty: Literal["easy", "medium", "hard"] = "medium"

    model_config = ConfigDict(extra="forbid")


# ---------- Analytics ----------

class ConceptTrendPoint(BaseModel):
    concept_id: str
    concept_name: str
    mastery: float
    trend: str
    created_at: datetime
