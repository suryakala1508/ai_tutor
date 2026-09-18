from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./tutor.db"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7

    anthropic_api_key: str = ""
    tutor_model: str = "claude-sonnet-5"
    quiz_model: str = "claude-sonnet-5"
    grading_model: str = "claude-sonnet-5"
    recommendation_model: str = "claude-sonnet-5"

    embedding_dim: int = 384

    retrieval_min_score: float = 0.3
    retrieval_top_k: int = 6

    rate_limit_tutor: str = "20/minute"
    rate_limit_quiz_gen: str = "15/minute"

    env: str = "development"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
