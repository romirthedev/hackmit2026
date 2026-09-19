import copy
from datetime import datetime

import pytest
from rewind.temporal import (
    day_overview_bounds,
    evidence_coverage,
    is_day_overview,
    select_temporal_evidence,
)


def sample(identifier, at, **extra):
    return {
        "id": identifier,
        "captured_at": at,
        "kind": "frame",
        "device": "phone",
        "boot": "session-a",
        "clock_quality": "device",
        "status": "done",
        "provenance": {"original": identifier},
        **extra,
    }


@pytest.mark.parametrize(
    "question",
    [
        "Summarize my entire day",
        "What did I do today?",
        "Can you recap my day?",
        "What happened yesterday?",
        "Summarize my entire day from the available recordings. What visible actions and objects are established?",
        "Recap my day; mention any gaps in the available footage.",
        "Give me an overview of my day, using only what is established.",
    ],
)
def test_overview_is_explicit(question):
    assert is_day_overview(question)


@pytest.mark.parametrize(
    "question",
    [
        "Where did I put my glasses today?",
        "What happened before I moved the notebook?",
        "Summarize what Alice said today",
        "What did I do after the appointment today?",
        "Describe my day after meeting Tom",
    ],
)
def test_focused_queries_do_not_change_retrieval(question):
    assert not is_day_overview(question)


def test_day_selection_recovers_morning_and_evening_despite_ranked_midday_cluster():
    ranked = [sample(f"lunch-{i}", 12 * 3600 + i) for i in range(20)]
    morning, evening = sample("morning", 8 * 3600), sample("evening", 20 * 3600)
    source = copy.deepcopy(ranked + [morning, evening])
    selected = select_temporal_evidence(ranked, [morning, evening], limit=4)
    assert [row["id"] for row in selected[:2]] == ["lunch-0", "lunch-1"]
    assert {row["id"] for row in selected} == {"lunch-0", "lunch-1", "morning", "evening"}
    assert ranked + [morning, evening] == source
    assert selected[0] is ranked[0]


def test_synthetic_stream_is_separate_and_temporally_distinct_sources_are_preferred():
    start = sample("start", 100)
    near = sample("near", 100.1)
    end = sample("end", 200)
    imported = sample("import", 0, boot="import", clock_quality="synthetic")
    selected = select_temporal_evidence([start], [near, end, imported], limit=3, relevance_slots=1)
    assert [row["id"] for row in selected] == ["start", "import", "end"]


def test_budget_duplicates_bad_clocks_and_nonphysical_sources():
    frame = sample("frame", 10)
    pool = [
        frame,
        sample("nan", float("nan")),
        sample("inf", float("inf")),
        sample("calendar", 20, source="notch"),
        sample("document", 20, kind="context"),
    ]
    assert select_temporal_evidence([frame], pool, limit=10) == [frame]
    assert select_temporal_evidence([frame], limit=0) == []
    with pytest.raises(ValueError):
        select_temporal_evidence([frame], limit=-1)


def test_coverage_receipt_cannot_claim_entire_day_from_two_samples():
    rows = [
        sample("morning", 8 * 3600),
        sample("evening", 20 * 3600, status="queued"),
        sample("synthetic", 12 * 3600, clock_quality="synthetic"),
        sample("old", -1),
    ]
    receipt = evidence_coverage(rows, after=0, before=24 * 3600)
    assert receipt["archive_samples_considered"] == 2
    assert receipt["largest_sample_gap_seconds"] == 12 * 3600
    assert receipt["seconds_before_first_sample"] == 8 * 3600
    assert receipt["seconds_after_last_sample"] == 4 * 3600
    assert receipt["pending_samples"] == 1
    assert receipt["excluded_nonhistorical_samples"] == 1
    assert receipt["continuous_coverage_established"] is False


def test_empty_archive_and_even_dense_samples_do_not_prove_complete_coverage():
    empty = evidence_coverage([], after=0, before=100)
    assert empty["first_sample_at"] is None
    assert empty["largest_sample_gap_seconds"] is None
    dense = evidence_coverage([sample(str(i), i) for i in range(101)], after=0, before=100)
    assert dense["largest_sample_gap_seconds"] == 1
    assert dense["continuous_coverage_established"] is False


@pytest.mark.parametrize(
    "now,expected_start,expected_hours",
    [
        ("2026-03-09T12:00:00-04:00", "2026-03-08T00:00:00-05:00", 23),
        ("2026-11-02T12:00:00-05:00", "2026-11-01T00:00:00-04:00", 25),
    ],
)
def test_yesterday_uses_local_calendar_across_dst(now, expected_start, expected_hours):
    after, before = day_overview_bounds(
        "What happened yesterday?", timezone="America/New_York", now=datetime.fromisoformat(now).timestamp()
    )
    assert after == datetime.fromisoformat(expected_start).timestamp()
    assert before - after == pytest.approx(expected_hours * 3600, abs=1e-5)
    assert before < after + expected_hours * 3600  # Inclusive SQL cannot cross midnight.


def test_overview_explicit_filters_are_not_replaced_with_today():
    assert day_overview_bounds("Recap my day", timezone="UTC", now=100, after=1, before=20) == (1, 20)
    assert day_overview_bounds("Recap my day", timezone="UTC", now=100, before=20) == (0, 20)


def test_later_instructions_do_not_change_explicit_today_into_yesterday():
    now = datetime.fromisoformat("2026-09-19T18:00:00-04:00").timestamp()
    after, _ = day_overview_bounds(
        "Summarize my day today. Do not use yesterday's footage.",
        timezone="America/New_York",
        now=now,
    )
    assert after == datetime.fromisoformat("2026-09-19T00:00:00-04:00").timestamp()
