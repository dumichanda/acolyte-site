"""Classify job postings into role families with an automation score.

    python pipeline/classify.py            # keyword rules (free, instant)
    python pipeline/classify.py --claude   # Claude Haiku 5.5 reads each posting (needs ANTHROPIC_API_KEY)
    python pipeline/classify.py --all      # re-classify everything, not just new jobs
"""
import argparse
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from pydantic import BaseModel

from db import connect, init_db
from taxonomy import BY_NAME, FAMILIES, FAMILY_NAMES, OTHER

CLAUDE_MODEL = "claude-haiku-5-5"


# ---------- Rules ----------

def classify_rules(title: str, description: str | None) -> dict:
    t = f" {title.lower()} "
    fam = next((f for f in FAMILIES if any(k in t for k in f["keywords"])), None)
    if fam is None and description:  # fall back to the description, weaker signal
        d = description.lower()[:400]
        fam = next((f for f in FAMILIES if any(k in d for k in f["keywords"] if len(k) > 8)), None)
    fam = fam or OTHER
    score = fam["score"]
    if re.search(r"\b(senior|manager|head|lead|supervisor|team leader)\b", t):
        score -= 15  # more judgement and people management
    elif re.search(r"\b(junior|entry|trainee|intern|learnership)\b", t):
        score += 5
    return {
        "role_family": fam["name"],
        "automation_score": max(0, min(100, score)),
        "automatable_tasks": fam["tasks"],
        "acolyte_service": fam["service"],
        "rationale": "Keyword rules on job title",
        "method": "rules",
        "model": None,
    }


# ---------- Claude ----------

class JobAssessment(BaseModel):
    role_family: Literal[tuple(FAMILY_NAMES)]  # type: ignore[valid-type]
    automation_score: int
    automatable_tasks: list[str]
    acolyte_service: str
    rationale: str


SYSTEM = f"""You assess South African job postings for Acolyte, an AI and automation implementation partner.
For each posting, decide how much of the role's day-to-day work could be automated with current tools
(RPA, document AI, AI agents, integrations, chatbots/WhatsApp bots, automated reporting).

- role_family: one of {FAMILY_NAMES}.
- automation_score: 0-100, the share of the role's working time that could realistically be automated.
  Repetitive capture/matching work scores high; judgement, relationships and physical work score low.
- automatable_tasks: 2-4 short task phrases taken from the posting.
- acolyte_service: one short phrase naming the solution Acolyte would pitch.
- rationale: one sentence.
Be conservative and specific to the posting text."""


def classify_claude(client, title: str, description: str | None) -> dict:
    import anthropic

    try:
        resp = client.messages.parse(
            model=CLAUDE_MODEL,
            max_tokens=2000,
            system=SYSTEM,
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": f"Title: {title}\n\nPosting:\n{(description or '')[:3000]}"}],
            output_format=JobAssessment,
        )
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        print(f"  Claude error for '{title}': {e.__class__.__name__}; using rules")
        return classify_rules(title, description)
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        return classify_rules(title, description)
    a = resp.parsed_output
    return {
        "role_family": a.role_family,
        "automation_score": max(0, min(100, a.automation_score)),
        "automatable_tasks": a.automatable_tasks[:4],
        "acolyte_service": a.acolyte_service,
        "rationale": a.rationale,
        "method": "claude",
        "model": CLAUDE_MODEL,
    }


# ---------- Main ----------

UPSERT = """
INSERT INTO classifications (job_id, role_family, automation_score, automatable_tasks, acolyte_service, rationale, method, model)
VALUES (%(job_id)s, %(role_family)s, %(automation_score)s, %(automatable_tasks)s, %(acolyte_service)s, %(rationale)s, %(method)s, %(model)s)
ON CONFLICT (job_id) DO UPDATE SET role_family = EXCLUDED.role_family, automation_score = EXCLUDED.automation_score,
    automatable_tasks = EXCLUDED.automatable_tasks, acolyte_service = EXCLUDED.acolyte_service,
    rationale = EXCLUDED.rationale, method = EXCLUDED.method, model = EXCLUDED.model, classified_at = now()
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    init_db()

    client = None
    if args.claude:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            sys.exit("Set ANTHROPIC_API_KEY in .env to use --claude")
        import anthropic
        client = anthropic.Anthropic()

    where = "" if args.all else "WHERE c.job_id IS NULL"
    with connect() as conn:
        jobs = conn.execute(
            f"SELECT j.id, j.title, j.description FROM jobs j LEFT JOIN classifications c ON c.job_id = j.id {where}"
        ).fetchall()
        print(f"Classifying {len(jobs)} jobs with {'Claude ' + CLAUDE_MODEL if client else 'rules'}...")

        def work(job):
            jid, title, desc = job
            res = classify_claude(client, title, desc) if client else classify_rules(title, desc)
            return {"job_id": jid, **res}

        with ThreadPoolExecutor(max_workers=args.workers if client else 1) as pool:
            results = list(pool.map(work, jobs))
        with conn.cursor() as cur:
            cur.executemany(UPSERT, results)

        rows = conn.execute(
            "SELECT role_family, count(*) FROM classifications GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall()
    for fam, n in rows:
        print(f"  {n:4d}  {fam}")


if __name__ == "__main__":
    main()
