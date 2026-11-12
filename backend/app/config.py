"""Application settings loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "SurplusConnect AI"
    APP_ENV: str = "production"
    ENABLE_DEV_SEED: bool = False
    BOOTSTRAP_ADMIN_EMAIL: str = ""
    BOOTSTRAP_ADMIN_PASSWORD: str = ""
    BOOTSTRAP_ADMIN_NAME: str = "Platform Administrator"
    BOOTSTRAP_ADMIN_ORG: str = "SurplusConnect Governance"
    JWT_SECRET_KEY: str = "dev-ephemeral-secret-change-in-production-surplusconnect-ai"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    MONGODB_URI: str = ""
    MONGODB_DB_NAME: str = "surplusconnect_ai"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.8-flash"

    GOOGLE_MAPS_API_KEY: str = ""

    PAYPAL_MODE: str = "sandbox"
    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""
    PAYPAL_BASE_URL: str = "https://api-m.sandbox.paypal.com"

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def has_mongodb_atlas(self) -> bool:
        return bool(self.MONGODB_URI and self.MONGODB_URI.strip())

    @property
    def has_gemini(self) -> bool:
        return bool(self.GEMINI_API_KEY and self.GEMINI_API_KEY.strip())

    @property
    def has_google_maps(self) -> bool:
        return bool(self.GOOGLE_MAPS_API_KEY and self.GOOGLE_MAPS_API_KEY.strip())

    @property
    def has_paypal(self) -> bool:
        return bool(
            self.PAYPAL_CLIENT_ID
            and self.PAYPAL_CLIENT_ID.strip()
            and self.PAYPAL_CLIENT_SECRET
            and self.PAYPAL_CLIENT_SECRET.strip()
        )

    @property
    def is_dev_seed_enabled(self) -> bool:
        return self.APP_ENV.lower() != "production" and self.ENABLE_DEV_SEED


@lru_cache
def get_settings() -> Settings:
    return Settings()

