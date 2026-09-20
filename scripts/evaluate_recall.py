#!/usr/bin/env python3
"""Run explicit recall questions against a real REWIND server and save raw results.

This records model responses and timings; it does not pretend citation validity
or the model's own confidence establishes factual correctness. Review against
original media. Credentials are read from the environment/.env, never emitted.
"""

import argparse
import json
import os
import re
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path, help="JSON containing a questions list")
    parser.add_argument("--server", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--after", type=float, help="Restrict to one evaluation recording interval")
    parser.add_argument("--before", type=float, help="Restrict to one evaluation recording interval")
    parser.add_argument(
        "--wait-review", action="store_true", help="Wait for the real Codex review when enabled"
    )
    args = parser.parse_args()
    env = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
    token = os.environ.get("REWIND_ADMIN_TOKEN") or env.get("REWIND_ADMIN_TOKEN")
    if not token:
        raise SystemExit("REWIND_ADMIN_TOKEN is missing")
    plan = json.loads(args.plan.read_text())
    report = {
        "plan": plan,
        "started_at": time.time(),
        "after": args.after,
        "before": args.before,
        "results": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(
        base_url=args.server.rstrip("/"),
        headers={"Authorization": "Bearer " + token},
        timeout=args.timeout,
    ) as client:
        response = client.get("/api/status")
        response.raise_for_status()
        report["status_before"] = response.json()
        checked_media = {}
        for item in plan["questions"]:
            started = time.monotonic()
            question = item["question"] if isinstance(item, dict) else item
            result = {"question": question}
            if isinstance(item, dict):
                result.update({key: item[key] for key in ("id", "criterion", "unanswerable") if key in item})
            try:
                response = client.post(
                    "/api/ask", json={"question": question, "after": args.after, "before": args.before}
                )
                response.raise_for_status()
                result["response"] = response.json()
                result["draft_seconds"] = round(time.monotonic() - started, 3)
                if args.wait_review and result["response"].get("mode") == "checking":
                    result["draft_response"] = result["response"]
                    deadline = time.monotonic() + args.timeout
                    while time.monotonic() < deadline:
                        reviewed = client.get("/api/answers")
                        reviewed.raise_for_status()
                        current = next(
                            (a for a in reviewed.json() if a["id"] == result["response"]["id"]), None
                        )
                        if current and current.get("mode") != "checking":
                            result["response"] = current
                            break
                        time.sleep(0.5)
                    else:
                        result["review_timeout"] = True
                answer = result["response"]
                evidence = answer.get("evidence", [])
                ids = {event["id"] for event in evidence}
                inline = set(re.findall(r"\[([0-9a-f-]{36})\]", answer.get("answer", "")))
                for event in evidence:
                    # Only inspect same-server recording routes returned by REWIND.
                    path = event.get("media_url", "")
                    if path not in checked_media:
                        checked_media[path] = bool(
                            path.startswith("/api/media/") and client.get(path).status_code == 200
                        )
                result["checks"] = {
                    "inline_citations_resolve": bool(inline) and inline <= ids,
                    "media_links_resolve": all(checked_media[e.get("media_url", "")] for e in evidence),
                    "evidence_count": len(evidence),
                    "evidence_kinds": sorted({event["kind"] for event in evidence}),
                    "note": "Structural checks only; factual correctness requires review of original media.",
                }
            except (httpx.HTTPError, ValueError) as error:
                result["error"] = str(error)
            result["seconds"] = round(time.monotonic() - started, 3)
            report["results"].append(result)
            args.output.write_text(json.dumps(report, indent=2) + "\n")
            print(
                json.dumps(
                    {
                        "question": question,
                        "seconds": result["seconds"],
                        "answer": result.get("response", {}).get("answer"),
                        "mode": result.get("response", {}).get("mode"),
                        "checks": result.get("checks"),
                        "error": result.get("error"),
                    }
                ),
                flush=True,
            )
        report["finished_at"] = time.time()
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
