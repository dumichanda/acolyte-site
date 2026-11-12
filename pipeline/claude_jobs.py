"""Find real South African job postings with Claude + web search.

Claude searches the web (and opens job-board pages) for current SA postings, then
returns them through the `save_jobs` tool. Every job is checked against what was
actually retrieved: a job is only stored if its URL appears in Claude's search
results or in a page it fetched, so invented listings are discarded.

    python pipeline/claude_jobs.py                 # 5 search terms (rotates daily)
    python pipeline/claude_jobs.py --terms 10      # more terms this run
    python pipeline/claude_jobs.py --term "creditors clerk"

Needs ANTHROPIC_API_KEY. Model: JOB_SEARCH_MODEL (default claude-opus-5-5).
Rough cost per term: a few web searches ($10 per 1,000 searches) plus tokens.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

from db import connect, init_db
from fetch_adzuna import SEARCH_TERMS
from taxonomy import PROVINCES

MODEL = os.environ.get("JOB_SEARCH_MODEL", "claude-opus-5-5")

SAVE_JOBS_TOOL = {
    "name": "save_jobs",
    "description": "Save the individual South African job postings you found. Call once with all postings.",
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["jobs"],
        "properties": {
            "jobs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "company", "city", "province", "posted_date", "url", "salary_text", "summary"],
                    "properties": {
                        "title": {"type": "string"},
                        "company": {"type": "string", "description": "Employer name, or recruitment agency name if the employer is hidden"},
                        "city": {"type": "string"},
                        "province": {"type": "string", "enum": PROVINCES + ["Unknown"]},
                        "posted_date": {"type": "string", "description": "YYYY-MM-DD, or empty if not shown"},
                        "url": {"type": "string", "description": "Exact URL of the individual posting, copied from a search result or fetched page"},
                        "salary_text": {"type": "string", "description": "Salary exactly as advertised, or empty"},
                        "summary": {"type": "string", "description": "1-2 sentences on the duties, from the posting"},
                    },
                },
            }
        },
    },
}

SYSTEM = """You collect current job postings in South Africa for a labour-market index.
Use web search (and web fetch to open job-board result pages) to find INDIVIDUAL job postings for the role you are given,
posted in the last 30 days, on sites such as PNet, Careers24, CareerJunction, Indeed South Africa, LinkedIn,
Executive Placements, Jobmail and company career pages.

Rules:
- Only include postings you actually saw. Copy each posting's URL exactly from a search result or a fetched page.
  Never construct or guess a URL.
- One entry per individual posting (not search pages or category pages). Skip duplicates of the same job.
- Aim for 10-25 postings. Quality over quantity.
- When done, call save_jobs once with everything you found."""


def norm_url(u: str) -> str:
    u = u.strip().rstrip("/")
    u = re.sub(r"^https?://(www\.)?", "", u, flags=re.I)
    return u.split("#")[0]


def evidence_text(content_blocks) -> str:
    """All URLs and page text Claude retrieved via server tools, as one searchable string."""
    parts = []
    for b in content_blocks:
        if b.type in ("web_search_tool_result", "web_fetch_tool_result"):
            parts.append(json.dumps(b.model_dump(mode="json"), ensure_ascii=False))
    text = "\n".join(parts)
    # Normalise so URLs match regardless of scheme, www or escaped slashes.
    text = text.replace("\\/", "/")
    return re.sub(r"https?://(www\.)?", "", text, flags=re.I)


def annual_salary(text: str) -> tuple[float | None, float | None]:
    """'R15 000 - R18 000 per month' -> (180000, 216000). Returns (None, None) when unclear."""
    if not text:
        return None, None
    t = text.lower().replace(",", "").replace(" ", " ")
    nums = []
    for m in re.finditer(r"r?\s*(\d[\d ]{2,9})(?:\.\d+)?\s*(k)?", t):
        n = float(m.group(1).replace(" ", ""))
        if m.group(2):
            n *= 1000
        if n >= 1000:
            nums.append(n)
    if not nums or "hour" in t:
        return None, None
    lo, hi = min(nums[:2]), max(nums[:2])
    monthly = any(w in t for w in ("month", "p/m", "pm", "p.m"))
    if monthly or hi < 120_000:  # SA ads mostly quote monthly salaries
        lo, hi = lo * 12, hi * 12
    if hi > 5_000_000:
        return None, None
    return lo, hi


def parse_date(s: str) -> datetime:
    try:
        d = date.fromisoformat(s[:10])
        if date.today() - timedelta(days=60) <= d <= date.today():
            return datetime(d.year, d.month, d.day, 9, tzinfo=timezone.utc)
    except ValueError:
        pass
    return datetime.now(timezone.utc)


def search_term(client, term: str) -> tuple[list[dict], dict]:
    """Run one search session. Returns (verified jobs, stats)."""
    tools = [
        {"type": "web_search_20250305", "name": "web_search", "max_uses": 5,
         "user_location": {"type": "approximate", "country": "ZA"}},
        {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 4},
        SAVE_JOBS_TOOL,
    ]
    messages = [{"role": "user", "content": f"Role: {term}\nFind current job postings in South Africa for this role."}]
    evidence, proposed, searches = "", [], 0
    for _ in range(8):  # cap on turns, including pause_turn resumes
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM,
            tools=tools,
            messages=messages,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        evidence += evidence_text(resp.content)
        su = getattr(resp.usage, "server_tool_use", None)
        searches += getattr(su, "web_search_requests", 0) or 0
        if resp.stop_reason == "refusal":
            break
        messages.append({"role": "assistant", "content": resp.content})
        if resp.stop_reason == "pause_turn":
            continue  # server-side tool loop paused; resend to resume
        calls = [b for b in resp.content if b.type == "tool_use" and b.name == "save_jobs"]
        if not calls:
            break  # end_turn without saving
        results = []
        for c in calls:
            jobs = c.input.get("jobs", []) if isinstance(c.input, dict) else []
            proposed.extend(jobs)
            results.append({"type": "tool_result", "tool_use_id": c.id, "content": f"Saved {len(jobs)} postings."})
        messages.append({"role": "user", "content": results})
        if resp.stop_reason == "tool_use":
            break  # jobs received; no need for a closing turn

    verified = verify(proposed, evidence)
    return verified, {"term": term, "proposed": len(proposed), "verified": len(verified), "searches": searches}


def verify(proposed: list[dict], evidence: str) -> list[dict]:
    seen, out = set(), []
    for j in proposed:
        url = (j.get("url") or "").strip()
        title = (j.get("title") or "").strip()
        if not url.startswith("http") or not title:
            continue
        key = norm_url(url)
        if key in seen or key not in evidence:  # not actually retrieved -> discard
            continue
        seen.add(key)
        out.append(j)
    return out


UPSERT = """
INSERT INTO jobs (id, source, is_demo, title, company, description, province, city, category,
                  contract_type, contract_time, salary_min, salary_max, salary_is_predicted,
                  posted_at, url, search_term, raw)
VALUES (%s,'web',FALSE,%s,%s,%s,%s,%s,NULL,NULL,NULL,%s,%s,FALSE,%s,%s,%s,%s)
ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description, fetched_at = now()
"""


def store(conn, jobs: list[dict], term: str) -> int:
    n = 0
    with conn.cursor() as cur:
        for j in jobs:
            title, company = j["title"].strip(), (j.get("company") or "").strip() or None
            # Skip if the same role at the same employer is already in the index (e.g. from Adzuna).
            dup = cur.execute(
                """SELECT 1 FROM jobs WHERE lower(title) = lower(%s) AND lower(coalesce(company,'')) = lower(coalesce(%s,''))
                   AND source <> 'web' AND posted_at >= now() - interval '60 days' LIMIT 1""",
                (title, company),
            ).fetchone()
            if dup:
                continue
            smin, smax = annual_salary(j.get("salary_text", ""))
            province = j.get("province") if j.get("province") in PROVINCES else None
            cur.execute(UPSERT, (
                "web:" + hashlib.sha1(norm_url(j["url"]).encode()).hexdigest()[:16],
                title, company, j.get("summary"), province, (j.get("city") or None),
                smin, smax, parse_date(j.get("posted_date") or ""), j["url"], term, json.dumps(j),
            ))
            n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--terms", type=int, default=int(os.environ.get("WEB_SEARCH_TERMS_PER_RUN", "5")))
    ap.add_argument("--term", action="append", help="search only this term (repeatable)")
    args = ap.parse_args()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY not set; skipping Claude web job search.")
        return

    import anthropic
    client = anthropic.Anthropic()
    init_db()

    if args.term:
        terms = args.term
    else:  # rotate through the list so every term is covered over a few days
        start = (date.today().toordinal() * args.terms) % len(SEARCH_TERMS)
        terms = [SEARCH_TERMS[(start + i) % len(SEARCH_TERMS)] for i in range(min(args.terms, len(SEARCH_TERMS)))]

    total = 0
    with connect() as conn:
        for term in terms:
            try:
                jobs, stats = search_term(client, term)
                status = "ok"
            except anthropic.RateLimitError:
                jobs, stats, status = [], {"term": term}, "error: rate limited"
            except (anthropic.APIConnectionError, anthropic.APIStatusError) as e:
                jobs, stats, status = [], {"term": term}, f"error: {e.__class__.__name__}"
            saved = store(conn, jobs, term) if jobs else 0
            conn.execute(
                "INSERT INTO fetch_log (source, search_term, page, results, status) VALUES ('claude_web', %s, 1, %s, %s)",
                (term, saved, status),
            )
            conn.commit()
            total += saved
            print(f"  '{term}': proposed {stats.get('proposed', 0)}, verified {stats.get('verified', 0)}, "
                  f"new {saved}, searches {stats.get('searches', 0)} ({status})")
    print(f"Claude web search added {total} postings.")


if __name__ == "__main__":
    sys.exit(main())
