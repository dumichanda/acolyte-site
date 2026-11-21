"""Load Essentials Basket offers saved as files (data/essentials/*.csv) into retail.offers.

Collections made outside GitHub Actions (for example from a session that can open a retailer's site) are saved as CSV in
the repo; the daily refresh loads any from the last LOAD_DAYS days. Upserts, so loading a file twice changes nothing.
"""
import csv
import os
from datetime import date, timedelta

from db import connect
from fetch_essentials import COLS, ROOT, classify, load, prepare, save


def parse(r: dict, basket: dict) -> tuple:
    """One saved offer; the same-brand / any-brand flags are recomputed with today's matching rules."""
    f = lambda v: float(v) if v not in ("", None) else None
    i = lambda v: int(float(v)) if v not in ("", None) else None
    b = lambda v: str(v).lower() == "true"
    return (date.fromisoformat(r["day"]), r["item"], r["product_id"], r["seller"], r["retailer"], r["channel"], r["title"],
            f(r["price"]), f(r["rating"]), i(r["reviews"]), i(r["position"]), *_flags(r, basket, b))


def _flags(r: dict, basket: dict, b) -> tuple:
    same, gen = classify(r["title"], basket[r["item"]]) if r["item"] in basket else (b(r["matches_item"]), b(r["matches_generic"]))
    return same, r["query"], gen


def main() -> None:
    since = date.today() - timedelta(days=int(os.environ.get("LOAD_DAYS", "14")))
    files = sorted((ROOT / "data" / "essentials").glob("*_????-??-??.csv"))   # dated offer files only (not pnp_links.csv)
    rows = []
    basket = {it["item"]: it for it in load()}
    for p in files:
        with open(p, newline="") as fh:
            got = [parse(r, basket) for r in csv.DictReader(fh)]
        got = [r for r in got if r[0] >= since]
        if got:
            print(f"{p.name}: {len(got)} offers")
            rows += got
    if not rows:
        print("No saved Essentials Basket files to load.")
        return
    with connect() as conn:
        prepare(conn, load())
    save(rows)
    print(f"Loaded {len(rows)} saved offers.")


if __name__ == "__main__":
    assert COLS
    main()
