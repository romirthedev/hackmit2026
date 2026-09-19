from typing import Literal

from pydantic import BaseModel, Field


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


class RecallAnswer(BaseModel):
    answer: str = Field(max_length=8000, description="Plain-language answer to the user's question, not a source ID")
    evidence_ids: list[str] = Field(max_length=20, description="IDs of recorded events supporting the answer")
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


class RuleRequest(BaseModel):
    instruction: str = Field(min_length=3, max_length=1000)
    cooldown_seconds: int = Field(default=60, ge=10, le=86400)
