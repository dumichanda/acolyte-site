"""SA retail prices: search Google Shopping South Africa (via Scrappa) for a fixed FMCG basket, once a day.

One call per basket query (~40 offers each). Offers are stored with a normalised retailer and channel, and a flag for
whether the title matches the basket item (brand and size tokens). The basket lives in data/retail_basket.csv.

    python fetch_retail.py [--max-calls 60]
"""
import argparse
import csv
import os
import re
from datetime import date
from pathlib import Path

from db import connect, fresh
import scrappa

ROOT = Path(__file__).resolve().parent.parent

# (substring of the seller name, retailer, channel). First match wins.
RETAILERS = [
    ("amazon", "Amazon.co.za", "online marketplace"),
    ("takealot", "Takealot", "online marketplace"),
    ("sixty60", "Checkers Sixty60", "quick commerce"),
    ("checkers", "Checkers", "grocery chain"),
    ("shoprite", "Shoprite", "grocery chain"),
    ("pick n pay", "Pick n Pay", "grocery chain"),
    ("pnp", "Pick n Pay", "grocery chain"),
    ("woolworths", "Woolworths", "grocery chain"),
    ("spar", "SPAR", "grocery chain"),
    ("food lover", "Food Lover's Market", "grocery chain"),
    ("boxer", "Boxer", "grocery chain"),
    ("usave", "Usave", "grocery chain"),
    ("ok foods", "OK Foods", "grocery chain"),
    ("makro", "Makro", "wholesale"),
    ("game", "Game", "wholesale"),
    ("superb hyper", "Superb Hyper", "wholesale"),
    ("dis-chem", "Dis-Chem", "pharmacy"),
    ("dischem", "Dis-Chem", "pharmacy"),
    ("clicks", "Clicks", "pharmacy"),
    ("mr d", "Mr D", "quick commerce"),
]


def retailer_of(seller: str | None) -> tuple[str, str]:
    s = (seller or "").lower()
    for sub, name, channel in RETAILERS:
        if re.search(rf"(^|[^a-z]){re.escape(sub)}([^a-z]|$)", s):
            return name, channel
    return (seller or "Unknown").strip()[:80], "other online store"


MULTIPACK = re.compile(r"\b(\d+\s*x\s*\d|x\s*\d+\b|\d+\s*(pack|pk)\b|pack of|case\b|bulk|bundle|carton|combo)", re.I)


def norm(title: str) -> str:
    """Lower case, '2 L' / '2 litre' -> '2l', '750 ML' -> '750ml', so sizes can be matched exactly."""
    t = title.lower().replace("-", " ").replace(",", ".")
    t = re.sub(r"(\d)\s*(litres?|liters?|lt)\b", r"\1l", t)
    t = re.sub(r"(\d)\s+(ml|l|kg|g)\b", r"\1\2", t)
    return t


def matches(title: str, tokens: list[str]) -> bool:
    """Every token present (sizes as whole words: '2l' must not match '12l') and not a multipack/case."""
    t = norm(title)
    if MULTIPACK.search(t) and not any("pack" in tok for tok in tokens):
        return False
    for tok in tokens:
        tok = tok.replace("-", " ")
        if re.match(r"^[\d.]+[a-z]*$", tok):   # size or count: whole word
            if not re.search(rf"(?<![\d.]){re.escape(tok)}s?(?![a-z\d])", t):
                return False
        elif tok not in t:
            return False
    return True


def load_basket() -> dict[str, dict]:
    items: dict[str, dict] = {}
    with open(ROOT / "data" / "retail_basket.csv", newline="") as f:
        for r in csv.DictReader(f):
            it = items.setdefault(r["item"], {"category": r["category"], "queries": [], "match": r["match"].lower().split("|"),
                                              "brand_type": r.get("brand_type") or "name brand", **size_of(r["item"])})
            it["queries"].append(r["query"])
    return items


def size_of(item: str) -> dict:
    """'Sunfoil sunflower oil 2L' -> 2 litres; 'Five Roses tea 100 bags' -> 100 units. Used for price per kg/litre/unit."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|ml|l|bags|s)?\s*$", item.lower()) or \
        re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b", item.lower())
    if not m or "size" in item.lower():
        return {"size_value": None, "size_unit": None}
    v, u = float(m.group(1)), m.group(2) or "units"
    if u == "g":
        v, u = v / 1000, "kg"
    elif u == "ml":
        v, u = v / 1000, "l"
    elif u in ("bags", "s"):
        u = "units"
    return {"size_value": v, "size_unit": u}


def num(v):
    try:
        return float(str(v).replace(",", "")) if v not in (None, "") else None
    except ValueError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-calls", type=int, default=int(os.environ.get("RETAIL_MAX_CALLS_PER_RUN", "100")))
    ap.add_argument("--items", type=int, default=0, help="only the first N basket items (testing)")
    a = ap.parse_args()
    if not scrappa.key():
        print("SCRAPPA_API_KEY not set; skipping retail prices.")
        return
    basket = load_basket()
    with connect() as conn:
        conn.execute((ROOT / "db" / "retail.sql").read_text())
        if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'analyst_reader'").fetchone():
            conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_reader")
        with conn.cursor() as cur:
            cur.executemany("""INSERT INTO retail.basket (item, category, queries, match, brand_type, size_value, size_unit)
                               VALUES (%s,%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (item) DO UPDATE SET category = EXCLUDED.category, queries = EXCLUDED.queries,
                               match = EXCLUDED.match, brand_type = EXCLUDED.brand_type, size_value = EXCLUDED.size_value,
                               size_unit = EXCLUDED.size_unit""",
                            [(k, v["category"], v["queries"], v["match"], v["brand_type"], v["size_value"], v["size_unit"])
                             for k, v in basket.items()])
        conn.commit()
        today = date.today()
        done = {r[0] for r in conn.execute("SELECT DISTINCT item FROM retail.offers WHERE day = %s", (today,))}
        todo = [(k, v) for k, v in basket.items() if k not in done]
        if a.items:
            todo = todo[: a.items]
        allowed = scrappa.allowance(conn, a.max_calls)
        c = scrappa.Client("google_shopping", allowed)
        rows = []
        def run(job):
            item, spec = job
            q = spec["queries"][0]   # one query per item per day; extra queries are alternates
            try:
                return item, spec, q, c.get("google/shopping", {"q": q, "gl": "za", "hl": "en"}, q)
            except scrappa.Budget:
                return item, spec, q, None

        from concurrent.futures import ThreadPoolExecutor
        try:
            with ThreadPoolExecutor(max_workers=6) as pool:
                for item, spec, q, d in pool.map(run, todo):
                    for r in (d or {}).get("shopping_results") or []:
                        if not r.get("product_id") or not r.get("title"):
                            continue
                        retailer, channel = retailer_of(r.get("source"))
                        rows.append((today, item, str(r["product_id"]), (r.get("source") or "")[:120], retailer, channel,
                                     r["title"][:300], num(r.get("extracted_price")), num(r.get("rating")),
                                     int(num(r.get("reviews")) or 0) or None, int(num(r.get("position")) or 0) or None,
                                     matches(r["title"], spec["match"]), q))
        except scrappa.Budget:
            print("Run call budget reached.")
        conn.commit()
        conn = fresh(conn)   # write on a new connection after the fetch
        with conn.cursor() as cur:
            cur.executemany("""INSERT INTO retail.offers (day, item, product_id, seller, retailer, channel, title, price, rating,
                                   reviews, position, matches_item, query) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (day, item, product_id, seller) DO UPDATE SET price = EXCLUDED.price""", rows)
        c.save_log(conn)
        conn.commit()
        m = sum(1 for r in rows if r[11])
        print(f"Retail: {c.used} searches, {len(rows)} offers ({m} matching the basket item).")


if __name__ == "__main__":
    main()
