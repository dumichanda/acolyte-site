"""Fetch live South African job postings from the Adzuna API.

Every API call is logged in fetch_log and counted against ADZUNA_CALL_BUDGET,
so a test account (25 calls) is never overspent.

Usage:
    python pipeline/fetch_adzuna.py                 # one page per search term
    python pipeline/fetch_adzuna.py --max-calls 5   # cap this run
    python pipeline/fetch_adzuna.py --dry-run       # show plan, call nothing
"""
import argparse
import os
import sys
import time
from datetime import datetime

import requests
from psycopg.types.json import Jsonb

from db import connect, init_db
from taxonomy import PROVINCES

API = "https://api.adzuna.com/v1/api/jobs/za/search/{page}"

# Ordered by priority: if the budget runs out, the most valuable terms are fetched first.
SEARCH_TERMS = [
    "creditors clerk",
    "claims administrator",
    "data capturer",
    "debtors clerk",
    "call centre agent",
    "collections agent",
    "payroll administrator",
    "bookkeeper",
    "sales administrator",
    "fica compliance",
    "logistics coordinator",
    "admin assistant",
]


def calls_used(conn) -> int:
    """Calls counted against the budget. ADZUNA_BUDGET_PERIOD = 'total' (test plan) or 'month' (paid plans)."""
    if os.environ.get("ADZUNA_BUDGET_PERIOD", "total") == "month":
        sql = "SELECT count(*) FROM fetch_log WHERE source = 'adzuna' AND run_at >= date_trunc('month', now())"
    else:
        sql = "SELECT count(*) FROM fetch_log WHERE source = 'adzuna'"
    return conn.execute(sql).fetchone()[0]


def province_city(area: list[str]) -> tuple[str | None, str | None]:
    """Adzuna location.area looks like ["South Africa", "Gauteng", "Johannesburg", ...]."""
    province = next((a for a in area if a in PROVINCES), None)
    if province is None:  # tolerate spelling variants such as "Kwazulu Natal"
        norm = {p.lower().replace("-", " "): p for p in PROVINCES}
        province = next((norm[a.lower().replace("-", " ")] for a in area if a.lower().replace("-", " ") in norm), None)
    city = area[2] if len(area) > 2 else None
    return province, city


def to_row(job: dict, term: str) -> tuple:
    area = (job.get("location") or {}).get("area") or []
    province, city = province_city(area)
    created = job.get("created")
    return (
        f"adzuna:{job['id']}",
        "adzuna",
        False,
        job.get("title", "").strip(),
        (job.get("company") or {}).get("display_name"),
        job.get("description"),
        province,
        city,
        (job.get("category") or {}).get("label"),
        job.get("contract_type"),
        job.get("contract_time"),
        job.get("salary_min"),
        job.get("salary_max"),
        str(job.get("salary_is_predicted")) == "1",
        datetime.fromisoformat(created.replace("Z", "+00:00")) if created else None,
        job.get("redirect_url"),
        term,
        Jsonb(job),
    )


UPSERT = """
INSERT INTO jobs (id, source, is_demo, title, company, description, province, city, category,
                  contract_type, contract_time, salary_min, salary_max, salary_is_predicted,
                  posted_at, url, search_term, raw)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, description = EXCLUDED.description, salary_min = EXCLUDED.salary_min,
    salary_max = EXCLUDED.salary_max, fetched_at = now(), raw = EXCLUDED.raw
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-calls", type=int, default=len(SEARCH_TERMS))
    ap.add_argument("--pages", type=int, default=1, help="pages per search term (50 jobs each)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    app_id, app_key = os.environ.get("ADZUNA_APP_ID"), os.environ.get("ADZUNA_APP_KEY")
    budget = int(os.environ.get("ADZUNA_CALL_BUDGET", "20"))
    if not (app_id and app_key):
        print("ADZUNA_APP_ID / ADZUNA_APP_KEY not set; skipping Adzuna.")
        return

    init_db()
    plan = [(t, p) for t in SEARCH_TERMS for p in range(1, args.pages + 1)][: args.max_calls]

    with connect() as conn:
        used = calls_used(conn)
        remaining = budget - used
        print(f"Adzuna calls used so far: {used}/{budget}. Planned this run: {len(plan)}.")
        if remaining <= 0:
            # Not an error: the rest of the pipeline still re-exports existing data.
            print("Call budget exhausted; skipping fetch. Raise ADZUNA_CALL_BUDGET after upgrading your Adzuna plan.")
            return
        plan = plan[:remaining]
        if args.dry_run:
            for t, p in plan:
                print(f"  would fetch '{t}' page {p}")
            return

        total = 0
        for term, page in plan:
            params = {
                "app_id": app_id, "app_key": app_key, "what": term,
                "results_per_page": 50, "content-type": "application/json",
                "sort_by": "date",
            }
            try:
                r = requests.get(API.format(page=page), params=params, timeout=30)
                r.raise_for_status()
                results = r.json().get("results", [])
                status = "ok"
            except requests.RequestException as e:
                results, status = [], f"error: {e.__class__.__name__}"
            # Log every attempt: failed calls still count against Adzuna's quota.
            conn.execute(
                "INSERT INTO fetch_log (source, search_term, page, results, status) VALUES ('adzuna', %s, %s, %s, %s)",
                (term, page, len(results), status),
            )
            if results:
                with conn.cursor() as cur:
                    cur.executemany(UPSERT, [to_row(j, term) for j in results])
            conn.commit()
            total += len(results)
            print(f"  '{term}' p{page}: {len(results)} jobs ({status})")
            time.sleep(1)

        print(f"Fetched {total} postings. Calls used: {calls_used(conn)}/{budget}.")


if __name__ == "__main__":
    main()
