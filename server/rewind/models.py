from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ConversationIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["memory", "computer", "chat", "ignore", "clarify"]
    directed_request: bool
    resolved_request: str = Field(max_length=1600)
    clarification: str = Field(max_length=350)


class ConversationReply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    needs_memory: bool
    answer: str = Field(max_length=1200)


class ObjectObservation(BaseModel):
    label: str = Field(max_length=100)
    description: str = Field(default="", max_length=500)
    location: str = Field(default="", max_length=500)
    bbox: list[float] = Field(default_factory=list, max_length=4)
    confidence: float = Field(default=0.5, ge=0, le=1)


class Observation(BaseModel):
    summary: str = Field(max_length=4000)
    objects: list[ObjectObservation] = Field(default_factory=list, max_length=50)
    tags: list[str] = Field(default_factory=list, max_length=30)
    confidence: float = Field(default=0.5, ge=0, le=1)


class CompactObservation(BaseModel):
    summary: str = Field(max_length=650)
    tags: list[str] = Field(max_length=6)


class DenseObservation(BaseModel):
    scene: str = Field(max_length=160)
    objects: list[str] = Field(max_length=8)
    people: int = Field(ge=0, le=1000)
    action: str = Field(max_length=120)
    text_visible: str = Field(max_length=220)


class RecallAnswer(BaseModel):
    answer: str = Field(
        max_length=8000, description="Plain-language answer to the user's question, not a source ID"
    )
    evidence_ids: list[str] = Field(
        max_length=20, description="Source labels such as E1 or E2 supporting the answer"
    )
    insufficient_evidence: bool = Field(description="True when the recordings do not establish the answer")


class SearchPlan(BaseModel):
    terms: str = ""
    anchor_terms: str = ""
    relation: Literal["before", "after", "none"] = "none"


class RuleDecision(BaseModel):
    triggered: bool = False
    explanation: str = ""


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    after: float | None = None
    before: float | None = None


class VideoProvenance(BaseModel):
    """Importer metadata, never inferred from the content by a language model."""

    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_offset: float = Field(ge=-3600, le=1e9, allow_inf_nan=False)
    source_pts: int
    time_base: str = Field(pattern=r"^[0-9]+/[1-9][0-9]*$", max_length=40)
    frame_index: int | None = Field(default=None, ge=0)
    clip_index: int = Field(ge=0)
    sample_fps: float = Field(ge=0, le=120, allow_inf_nan=False)
    clock: Literal["recording_start", "synthetic"]


class RuleRequest(BaseModel):
    instruction: str = Field(min_length=3, max_length=1000)
    cooldown_seconds: int = Field(default=60, ge=10, le=86400)
