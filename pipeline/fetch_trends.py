"""Google Trends demand signals for South Africa (via Scrappa), pulled once a week.

Each group of up to 5 related terms is one call (90 days of daily values, relative within the group).
Six groups a week: ~25 credits a month.

    python fetch_trends.py [--force]
"""
import argparse
from datetime import date, datetime, timezone
from pathlib import Path

from db import connect
import scrappa

ROOT = Path(__file__).resolve().parent.parent

GROUPS = [
    ("property", "property: buying vs renting", ["houses for sale", "flats to rent", "property24", "bond calculator", "rent to own"]),
    ("property", "property: metros", ["houses for sale johannesburg", "houses for sale cape town", "houses for sale durban",
                                      "houses for sale pretoria", "houses for sale gqeberha"]),
    ("jobs", "jobs: job seeking", ["jobs", "vacancies", "learnerships", "cv template", "unemployment"]),
    ("jobs", "jobs: work style", ["remote jobs", "part time jobs", "work from home", "government jobs", "internships"]),
    ("retail", "retail: specials by retailer", ["checkers specials", "pick n pay specials", "shoprite specials",
                                                "woolworths specials", "spar specials"]),
    ("marketplace", "marketplace: online shopping", ["takealot", "amazon south africa", "temu", "shein", "black friday"]),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if not scrappa.key():
        print("SCRAPPA_API_KEY not set; skipping Google Trends.")
        return
    with connect() as conn:
        conn.execute((ROOT / "db" / "signals.sql").read_text())
        if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'analyst_reader'").fetchone():
            conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_reader")
        conn.commit()
        last = conn.execute("SELECT max(pulled_on) FROM signals.search_interest").fetchone()[0]
        if last and (date.today() - last).days < 7 and not a.force:
            print(f"Google Trends pulled on {last}; next pull after 7 days.")
            return
        c = scrappa.Client("google_trends", scrappa.allowance(conn, len(GROUPS)))
        rows = []
        try:
            for analyst, group, terms in GROUPS:
                d = c.get("google-trends/interest", {"q": ",".join(terms), "geo": "ZA", "time_range": "90d"}, f"trends: {group}")
                for pt in (d or {}).get("timeline_data") or []:
                    day = datetime.fromtimestamp(int(pt["timestamp"]), timezone.utc).date()
                    for v in pt.get("values") or []:
                        if v.get("has_data", True):
                            rows.append((v.get("query"), group, analyst, day, v.get("value"), date.today()))
        except scrappa.Budget:
            print("Budget reached.")
        with conn.cursor() as cur:
            cur.executemany("""INSERT INTO signals.search_interest VALUES (%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (term, term_group, day) DO UPDATE SET interest = EXCLUDED.interest,
                               pulled_on = EXCLUDED.pulled_on""", rows)
        c.save_log(conn)
        conn.commit()
        print(f"Google Trends: {len(rows)} daily values from {c.used} calls.")


if __name__ == "__main__":
    main()
