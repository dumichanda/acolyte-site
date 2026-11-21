"""Essentials Basket: ~120 everyday packaged items priced at every major SA retailer we can reach, twice a week.

For each item: one general Google Shopping search (via Scrappa), then a search naming each trackable retailer that the
general search missed. Every offer is checked two ways: the exact brand and size ("same brand everywhere") and any
brand of the same type and size ("cheapest equivalent"). Pick n Pay, SPAR and Boxer don't appear in this source.

    python fetch_essentials.py [--force] [--max-calls 900] [--items N]
Runs on ESSENTIALS_DAYS (weekday numbers, default "0,3" = Monday and Thursday) unless --force.
"""
import argparse
import csv
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from db import connect, fresh
import scrappa
from fetch_retail import matches, num, retailer_of

ROOT = Path(__file__).resolve().parent.parent
GROCERY = ["Shoprite", "Checkers", "Woolworths", "Makro"]      # targeted when the general search misses them
PHARMACY = ["Dis-Chem", "Clicks"]                                # targeted for personal care, health and baby
PHARM_CATS = {"Personal care", "Health", "Baby"}
ALIAS = {"Checkers Sixty60": "Checkers"}


def load() -> list[dict]:
    with open(ROOT / "data" / "essentials_basket.csv", newline="") as f:
        return list(csv.DictReader(f))


def size_of(match: str) -> tuple[float | None, str | None]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b", match)
    if not m:
        return None, None
    v, u = float(m.group(1)), m.group(2)
    return (v / 1000, "kg") if u == "g" else (v / 1000, "l") if u == "ml" else (v, u)


def offers_from(d: dict | None, it: dict, q: str, today) -> list[tuple]:
    out = []
    for r in (d or {}).get("shopping_results") or []:
        if not r.get("product_id") or not r.get("title"):
            continue
        retailer, channel = retailer_of(r.get("source"))
        sku = matches(r["title"], it["match"].split("|"))
        gen = sku or matches(r["title"], it["generic"].split("|"))
        out.append((today, it["item"], str(r["product_id"]), (r.get("source") or "")[:120], retailer, channel, r["title"][:300],
                    num(r.get("extracted_price")), num(r.get("rating")), int(num(r.get("reviews")) or 0) or None,
                    int(num(r.get("position")) or 0) or None, sku, q, gen))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max-calls", type=int, default=int(os.environ.get("ESSENTIALS_MAX_CALLS", "900")))
    ap.add_argument("--items", type=int, default=0)
    ap.add_argument("--out", help="write offers to this CSV instead of the database (load later with load_essentials.py)")
    a = ap.parse_args()
    days = {int(x) for x in os.environ.get("ESSENTIALS_DAYS", "0,3").split(",") if x.strip()}
    if not a.force and date.today().weekday() not in days:
        print(f"Essentials Basket runs on weekdays {sorted(days)} (0 = Monday); not today.")
        return
    if not scrappa.key():
        print("SCRAPPA_API_KEY not set; skipping the Essentials Basket.")
        return
    items = load()[: a.items or None]
    today = date.today()
    if a.out:
        c = scrappa.Client("google_shopping", a.max_calls)
        rows = collect(c, items, today)
        write_csv(a.out, rows)
        print(f"Essentials: {c.used} searches, {len(rows)} offers written to {a.out}.")
        return
    with connect() as conn:
        prepare(conn, items)
        c = scrappa.Client("google_shopping", scrappa.allowance(conn, a.max_calls))
    rows = collect(c, items, today)
    save(rows)
    c.save_log(conn := fresh())
    conn.commit()
    with conn:
        cov = conn.execute("""SELECT retailer, items_same_brand, items_any_brand FROM analyst.essentials_index
                              WHERE day = %s ORDER BY items_any_brand DESC LIMIT 12""", (today,)).fetchall()
    print(f"Essentials: {c.used} searches, {len(rows)} offers. Coverage (same brand / any brand): "
          + "; ".join(f"{r} {s}/{g}" for r, s, g in cov))


def prepare(conn, items: list[dict]) -> None:
    """Schema and basket definitions (shared by this fetch, the retailer-site matcher and the CSV loader)."""
    conn.execute((ROOT / "db" / "retail.sql").read_text())
    if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'analyst_reader'").fetchone():
        conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_reader")
    with conn.cursor() as cur:
        cur.executemany("""INSERT INTO retail.basket (item, category, queries, match, brand_type, size_value, size_unit, basket, generic)
                           VALUES (%s,%s,%s,%s,'name brand',%s,%s,'essentials',%s)
                           ON CONFLICT (item) DO UPDATE SET category = EXCLUDED.category, queries = EXCLUDED.queries,
                           match = EXCLUDED.match, size_value = EXCLUDED.size_value, size_unit = EXCLUDED.size_unit,
                           basket = 'essentials', generic = EXCLUDED.generic""",
                        [(it["item"], it["category"], [it["query"]], it["match"].split("|"), *size_of(it["match"]),
                          it["generic"].split("|")) for it in items])
    conn.commit()


COLS = ["day", "item", "product_id", "seller", "retailer", "channel", "title", "price", "rating", "reviews", "position",
        "matches_item", "query", "matches_generic"]


def write_csv(path: str, rows: list[tuple]) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLS)
        w.writerows(rows)


def save(rows: list[tuple]) -> None:
    """Upsert offers into retail.offers (used by this fetch, the retailer-site fetch and the CSV loader)."""
    conn = fresh()
    with conn:
        with conn.cursor() as cur:
            cur.executemany("""INSERT INTO retail.offers (day, item, product_id, seller, retailer, channel, title, price, rating,
                                   reviews, position, matches_item, query, matches_generic)
                               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (day, item, product_id, seller) DO UPDATE SET price = EXCLUDED.price,
                                   matches_generic = EXCLUDED.matches_generic OR retail.offers.matches_generic""", rows)
        conn.commit()


def collect(c, items: list[dict], today) -> list[tuple]:
    rows: list[tuple] = []

    def search(job):
        it, q = job
        try:
            return it, q, c.get("google/shopping", {"q": q, "gl": "za", "hl": "en"}, f"essentials: {q}")
        except scrappa.Budget:
            return it, q, None

    with ThreadPoolExecutor(max_workers=4) as pool:          # 1. one general search per item
        for it, q, d in pool.map(search, [(it, it["query"]) for it in items]):
            rows += offers_from(d, it, q, today)
        found = {(r[1], ALIAS.get(r[4], r[4])) for r in rows if r[11] or r[13]}
        targets = [(it, f'{it["query"]} {ret}') for it in items                     # 2. name the retailers it missed
                   for ret in GROCERY + (PHARMACY if it["category"] in PHARM_CATS else []) if (it["item"], ret) not in found]
        print(f"Essentials: {len(items)} general searches; {len(targets)} retailer searches for gaps.")
        for it, q, d in pool.map(search, targets):
            rows += offers_from(d, it, q, today)

    return rows


if __name__ == "__main__":
    main()
