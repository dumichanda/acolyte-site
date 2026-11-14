"""Shared Scrappa API client: budgets, retries and call logging for every Scrappa-backed dataset.

Each successful call costs 1 credit (failed calls are free). All Scrappa sources share SCRAPPA_MONTHLY_BUDGET;
each fetcher also has its own per-run cap. Calls are logged in fetch_log with the dataset as `source`.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://scrappa.co/api/"
SOURCES = ("privateproperty", "google_shopping", "google_jobs", "linkedin_jobs", "glassdoor")


class Budget(Exception):
    pass


def key() -> str:
    return os.environ.get("SCRAPPA_API_KEY", "")


def month_used(conn) -> int:
    return conn.execute("""SELECT count(*) FROM fetch_log WHERE source = ANY(%s) AND status = 'ok'
                           AND run_at >= date_trunc('month', now())""", (list(SOURCES),)).fetchone()[0]


def allowance(conn, run_cap: int) -> int:
    monthly = int(os.environ.get("SCRAPPA_MONTHLY_BUDGET", "15000"))
    used = month_used(conn)
    left = max(0, min(run_cap, monthly - used))
    print(f"Scrappa credits this month: {used}/{monthly}. Allowed this run: {left}.")
    return left


class Client:
    def __init__(self, source: str, max_calls: int):
        self.source, self.left, self.used = source, max_calls, 0
        self.log: list[tuple] = []

    def get(self, path: str, params: dict, label: str = "") -> dict | None:
        if self.left <= 0:
            raise Budget()
        self.left -= 1
        url = BASE + path + "?" + urllib.parse.urlencode(params, doseq=True)
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"X-API-KEY": key(), "Accept": "application/json",
                                                           "User-Agent": "acolyte-pipeline/1.0"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    d = json.load(r)
                self.used += 1
                self.log.append((label or path, None, 1, "ok"))
                return d
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(3 * (attempt + 1))
                    continue
                self.log.append((label or path, None, 0, f"http {e.code}"))
                return None
            except Exception as e:
                if attempt < 2:
                    time.sleep(2)
                    continue
                self.log.append((label or path, None, 0, f"error {type(e).__name__}"))
                return None

    def save_log(self, conn) -> None:
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO fetch_log (source, search_term, page, results, status) VALUES (%s,%s,%s,%s,%s)",
                            [(self.source, t[:200], p, n, s) for t, p, n, s in self.log])
        self.log = []
