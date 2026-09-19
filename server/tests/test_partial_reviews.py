import json

import pytest
from rewind.memory import Memory
from rewind.models import RecallAnswer, SearchPlan
from rewind.verification import Verifier
from test_day_memory import add_frame
from test_day_memory import workspace as workspace


class CandidateProvider:
    def __init__(self, *, insufficient, cited=True):
        self.insufficient, self.cited = insufficient, cited

    async def embed(self, query):
        return None

    async def structured(self, system, body, schema, **kwargs):
        if schema is SearchPlan:
            return SearchPlan(terms="cup", anchor_terms="breakfast", relation="after")
        return RecallAnswer(
            answer="A green cup is visible [E1]." if self.cited else "No useful evidence.",
            evidence_ids=["E1"] if self.cited else [],
            insufficient_evidence=self.insufficient,
        )


class Runner:
    def __init__(self, *, disagree=False, reviewer_insufficient=False):
        self.disagree, self.reviewer_insufficient = disagree, reviewer_insufficient
        self.calls = []

    async def run(self, model, prompt, images, schema):
        payload = json.loads(prompt.rsplit("\n", 1)[-1])
        self.calls.append((model, payload))
        if model == "gpt-6-astra":
            result = schema.model_validate(
                {
                    "verdict": "unsupported" if self.disagree else "supported",
                    "insufficient_evidence": self.reviewer_insufficient,
                    "answer": "A green object is visible [E1]."
                    if self.disagree
                    else "A green cup is visible [E1].",
                    "evidence_ids": ["E1"],
                    "reason": "Only this limited visual fact is supported.",
                }
            )
        else:
            result = schema.model_validate({"winner": "astra", "reason": "The narrower claim is supported."})
        return result, {"model": model, "result": result.model_dump()}


@pytest.mark.parametrize(
    "insufficient,mode,grounded", [(True, "insufficient", False), (False, "verified", True)]
)
async def test_cited_partial_and_adequate_answers_both_receive_review(
    workspace, insufficient, mode, grounded
):
    db, settings, _ = workspace
    identifier = add_frame(workspace, 1000, summary="Green cup on counter")
    runner = Runner()
    verifier = Verifier(db, settings, runner)
    result = await Memory(db, CandidateProvider(insufficient=insufficient), settings, verifier=verifier).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    assert result["mode"] == "checking" and not result["grounded"]
    await verifier.process(verifier.claim())
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == mode and bool(stored["grounded"]) is grounded
    assert "A green cup is visible" in stored["answer"]
    assert f"[{identifier}]" in stored["answer"]
    assert len(runner.calls) == 1
    receipt = verifier.public(result["id"])["receipt"]
    assert receipt["claims_reviewed"] and receipt["answer_complete"] is grounded


async def test_sol_correction_does_not_promote_an_incomplete_candidate(workspace):
    db, settings, _ = workspace
    add_frame(workspace, 1000, summary="Green cup on counter")
    runner = Runner(disagree=True)
    verifier = Verifier(db, settings, runner)
    result = await Memory(db, CandidateProvider(insufficient=True), settings, verifier=verifier).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    await verifier.process(verifier.claim())
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == "insufficient" and not stored["grounded"]
    assert "A green object is visible" in stored["answer"]
    assert [model for model, _ in runner.calls] == ["gpt-6-astra", "gpt-5.6-sol"]
    assert not verifier.public(result["id"])["receipt"]["answer_complete"]


@pytest.mark.parametrize("disagree", [False, True])
async def test_astra_can_mark_complete_qwen_candidate_or_own_correction_incomplete(workspace, disagree):
    db, settings, _ = workspace
    add_frame(workspace, 1000, summary="Green cup on counter")
    runner = Runner(disagree=disagree, reviewer_insufficient=True)
    verifier = Verifier(db, settings, runner)
    result = await Memory(db, CandidateProvider(insufficient=False), settings, verifier=verifier).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    await verifier.process(verifier.claim())
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == "insufficient" and not stored["grounded"]
    assert ("A green object" if disagree else "A green cup") in stored["answer"]
    assert not verifier.public(result["id"])["receipt"]["answer_complete"]
    assert len(runner.calls) == (2 if disagree else 1)


def test_astra_review_requires_an_explicit_completeness_decision():
    from pydantic import ValidationError
    from rewind.verification import Review

    assert "insufficient_evidence" in Review.model_json_schema()["required"]
    with pytest.raises(ValidationError):
        Review.model_validate(
            {
                "verdict": "unsupported",
                "answer": "Only one detail is supported.",
                "evidence_ids": ["E1"],
                "reason": "Missing the rest of the event.",
            }
        )


async def test_relative_anchor_uncertainty_survives_review(workspace):
    db, settings, _ = workspace
    add_frame(workspace, 1000, summary="Green cup on counter")
    runner = Runner()
    verifier = Verifier(db, settings, runner)
    result = await Memory(db, CandidateProvider(insufficient=False), settings, verifier=verifier).ask(
        "What color was the cup after breakfast?",
        after=0,
        before=2000,
    )
    assert result["mode"] == "checking"
    await verifier.process(verifier.claim())
    assert runner.calls[0][1]["temporal_warning"]
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == "insufficient" and not stored["grounded"]
    assert "relative-time reference event remains unverified" in stored["answer"]


async def test_uncited_abstention_remains_deterministic_and_does_not_run_models(workspace):
    db, settings, _ = workspace
    add_frame(workspace, 1000, summary="Green cup on counter")
    runner = Runner()
    verifier = Verifier(db, settings, runner)
    result = await Memory(
        db, CandidateProvider(insufficient=True, cited=False), settings, verifier=verifier
    ).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    assert result["answer"] == "The available recordings do not establish an answer to that question."
    assert not result["grounded"] and not result["evidence"]
    assert verifier.claim() is None and not runner.calls


async def test_partial_review_still_rechecks_original_hashes_after_model_returns(workspace):
    db, settings, _ = workspace
    add_frame(workspace, 1000, summary="Green cup on counter")

    class MutatingRunner(Runner):
        async def run(self, model, prompt, images, schema):
            from pathlib import Path

            path = Path(images[0])
            path.write_bytes(path.read_bytes() + b"changed-during-review")
            return await super().run(model, prompt, images, schema)

    verifier = Verifier(db, settings, MutatingRunner())
    result = await Memory(db, CandidateProvider(insufficient=True), settings, verifier=verifier).ask(
        "What color is the cup?",
        after=0,
        before=2000,
    )
    await verifier.process(verifier.claim())
    stored = db.one("SELECT * FROM answers WHERE id=?", (result["id"],))
    assert stored["mode"] == "unavailable" and not stored["grounded"]
    assert "green cup" not in stored["answer"]
