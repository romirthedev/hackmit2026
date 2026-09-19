from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="REWIND_", env_file=".env", extra="ignore")
    admin_token: str = ""
    device_token: str = ""
    device_id: str = "necklace-01"
    data_dir: Path = Path("data")
    provider: Literal["ollama", "openai", "disabled"] = "ollama"
    ollama_url: str = "http://127.0.0.1:11434"
    vision_model: str = "qwen3.5:35b-a3b-q4_K_M"
    reasoning_model: str = "qwen3.5:35b-a3b-q4_K_M"
    ollama_think: bool = False
    embedding_model: str = "nomic-embed-text"
    embeddings: bool = True
    whisper_model: str = "small.en"
    whisper_device: str = "cpu"
    whisper_compute: str = "int8"
    workers: int = Field(1, ge=0, le=8)
    max_storage_gb: float = Field(100, gt=0)
    min_free_gb: float = Field(2, ge=0)
    timezone: str = "America/New_York"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    elastic_url: str = ""
    elastic_api_key: str = ""
    cookie_secure: bool = False
    max_upload_bytes: int = 20 * 1024 * 1024

    def validate_secrets(self):
        for name in ("admin_token", "device_token"):
            if len(getattr(self, name)) < 24:
                raise ValueError(f"{name} must have at least 24 characters. Run python scripts/setup.py.")
        if self.admin_token == self.device_token:
            raise ValueError("Admin and device tokens must differ.")
