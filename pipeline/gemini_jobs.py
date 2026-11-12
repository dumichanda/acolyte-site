"""Find real South African job postings with Gemini + Google Search grounding.

Free API key: https://aistudio.google.com/apikey  ->  GEMINI_API_KEY
Model: GEMINI_MODEL (default gemini-2.5-flash).

Gemini searches Google for current SA postings and lists them as JSON. Each job is then
verified before it is stored, because a language model can make up links:
  1. its URL matches a page Google Search actually returned (grounding sources), or
  2. the URL opens (HTTP 200) and the page contains the job title.
Anything that fails both checks is discarded.

    python pipeline/gemini_jobs.py                  # 5 roles, rotating daily
    python pipeline/gemini_jobs.py --terms 12       # all roles
    python pipeline/gemini_jobs.py --term "claims administrator"
"""
import argparse
import json
import os
import re
import time
from datetime import date

import requests

from claude_jobs import norm_url, store
from db import connect, init_db
from fetch_adzuna import SEARCH_TERMS
from taxonomy import PROVINCES

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
ALIASES = {"GP": "Gauteng", "GAUTENG": "Gauteng", "WC": "Western Cape", "KZN": "KwaZulu-Natal", "KWAZULUNATAL": "KwaZulu-Natal",
           "EC": "Eastern Cape", "FS": "Free State", "MP": "Mpumalanga", "LP": "Limpopo", "NW": "North West", "NC": "Northern Cape"}
UA = {"User-Agent": "Mozilla/5.0 (compatible; AcolyteIndexBot/1.0; job-market research)"}

PROMPT = """Use Google Search to find current, individual job postings in South Africa for the role: "{term}".
Only postings from the last 30 days, on sites such as PNet, Careers24, CareerJunction, Indeed South Africa,
LinkedIn, Executive Placements, Jobmail or company career pages. Find 10 to 25 postings.

Return ONLY a JSON array, no other text. Each item:
{{"title": "...", "company": "...", "city": "...", "province": one of {provinces} or "Unknown",
  "posted_date": "YYYY-MM-DD or empty", "url": "the posting's own URL exactly as found",
  "salary_text": "salary as advertised or empty", "summary": "1-2 sentences on the duties"}}
Never invent or guess a URL. If you cannot find the posting's own URL, leave that job out."""


def parse_json_array(text: str) -> list[dict]:
    """Extract the JSON array from a model reply (tolerates ```json fences and surrounding text)."""
    if not text:
        return []
    m = re.search(r"\[.*\]", text, flags=re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return [d for d in data if isinstance(d, dict)]


def resolve(uri: str, session: requests.Session) -> str | None:
    """Grounding sources are Google redirect links; follow them to the real page URL."""
    try:
        r = session.head(uri, allow_redirects=True, timeout=10, headers=UA)
        return r.url
    except requests.RequestException:
        return None


def live_check(job: dict, session: requests.Session) -> bool:
    """URL opens and the page mentions the job title (at least 2/3 of its main words)."""
    try:
        r = session.get(job["url"], timeout=12, headers=UA)
    except requests.RequestException:
        return False
    if r.status_code != 200:
        return False
    page = r.text.lower()
    words = [w for w in re.findall(r"[a-z]{4,}", job["title"].lower())]
    if not words:
        return False
    return sum(w in page for w in words) >= max(1, round(len(words) * 2 / 3))


def verify(proposed: list[dict], sources: list[str], session: requests.Session) -> tuple[list[dict], dict]:
    src = [norm_url(s) for s in sources if s]
    seen, out, by = set(), [], {"source": 0, "live": 0, "rejected": 0}
    for j in proposed:
        url, title = (j.get("url") or "").strip(), (j.get("title") or "").strip()
        if not url.startswith("http") or not title:
            by["rejected"] += 1
            continue
        key = norm_url(url)
        if key in seen:
            continue
        seen.add(key)
        if any(key == s or key.startswith(s + "/") or s.startswith(key) for s in src):
            j["verified_by"] = "search_source"
            by["source"] += 1
        elif live_check(j, session):
            j["verified_by"] = "live_page"
            by["live"] += 1
        else:
            by["rejected"] += 1
            continue
        prov = (j.get("province") or "").strip()
        j["province"] = prov if prov in PROVINCES else ALIASES.get(prov.upper().replace(" ", ""), "Unknown")
        out.append(j)
    return out, by


def search_term(client, term: str, session: requests.Session) -> tuple[list[dict], dict]:
    from google.genai import types

    resp = client.models.generate_content(
        model=MODEL,
        contents=PROMPT.format(term=term, provinces=json.dumps(PROVINCES)),
        config=types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())], temperature=0.2),
    )
    proposed = parse_json_array(resp.text or "")
    sources = []
    for cand in resp.candidates or []:
        gm = cand.grounding_metadata
        for ch in (gm.grounding_chunks if gm and gm.grounding_chunks else []):
            if ch.web and ch.web.uri:
                real = resolve(ch.web.uri, session)
                if real:
                    sources.append(real)
    jobs, by = verify(proposed, sources, session)
    return jobs, {"term": term, "proposed": len(proposed), "sources": len(sources), **by}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--terms", type=int, default=int(os.environ.get("WEB_SEARCH_TERMS_PER_RUN", "5")))
    ap.add_argument("--term", action="append")
    args = ap.parse_args()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY not set; skipping Gemini job search.")
        return

    from google import genai
    from google.genai import errors

    client = genai.Client(api_key=key)
    session = requests.Session()
    init_db()

    if args.term:
        terms = args.term
    else:  # rotate through all roles over a few days
        start = (date.today().toordinal() * args.terms) % len(SEARCH_TERMS)
        terms = [SEARCH_TERMS[(start + i) % len(SEARCH_TERMS)] for i in range(min(args.terms, len(SEARCH_TERMS)))]

    total = 0
    with connect() as conn:
        for term in terms:
            try:
                jobs, stats = search_term(client, term, session)
                status = "ok"
            except errors.ClientError as e:  # 4xx: bad key, quota exhausted, unknown model
                jobs, stats, status = [], {"term": term}, f"error: {e.code} {str(e)[:120]}"
            except errors.ServerError as e:
                jobs, stats, status = [], {"term": term}, f"error: {e.code}"
            saved = store(conn, jobs, term) if jobs else 0
            conn.execute(
                "INSERT INTO fetch_log (source, search_term, page, results, status) VALUES ('gemini_web', %s, 1, %s, %s)",
                (term, saved, status),
            )
            conn.commit()
            total += saved
            print(f"  '{term}': proposed {stats.get('proposed', 0)}, verified via search {stats.get('source', 0)} "
                  f"+ live page {stats.get('live', 0)}, rejected {stats.get('rejected', 0)}, new {saved} ({status})")
            time.sleep(4)  # stay inside free-tier rate limits
    print(f"Gemini web search added {total} postings.")


if __name__ == "__main__":
    main()
