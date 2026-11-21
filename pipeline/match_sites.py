"""Turn a retailer's own shelf catalogue (read from its public category pages, see pipeline/sites/) into Essentials Basket offers.

Each product is checked against every basket item two ways, as Google Shopping offers are: the exact brand and size
("same brand everywhere") and any brand of the same type and size ("cheapest equivalent"). Regular shelf prices only;
member or promotional prices are kept out of the price so retailers compare like for like.

    python match_sites.py <catalog.jsonl> [--out offers.csv]     (without --out, writes to the database)
"""
import argparse
import json
from datetime import date
from pathlib import Path

from db import connect
from fetch_essentials import load, prepare, save, write_csv
from fetch_retail import matches, retailer_of

SITE = {"Pick n Pay": "pnp.co.za"}


def offers(catalog: list[dict], items: list[dict], day: date) -> list[tuple]:
    rows = []
    for p in catalog:
        if not p.get("price") or p.get("in_stock") is False:
            continue
        retailer, channel = retailer_of(p["retailer"])
        for it in items:
            sku = matches(p["title"], it["match"].split("|"))
            gen = sku or matches(p["title"], it["generic"].split("|"))
            if gen:
                rows.append((day, it["item"], f'site:{p["code"]}', p["retailer"], retailer, channel, p["title"][:300],
                             float(p["price"]), None, None, None, sku, f'site:{SITE.get(p["retailer"], p["retailer"])}', gen))
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("catalog")
    ap.add_argument("--out")
    ap.add_argument("--day", default="")
    a = ap.parse_args()
    path = Path(a.catalog)
    day = date.fromisoformat(a.day) if a.day else date.fromisoformat(path.stem.split("_")[-1]) if "_" in path.stem else date.today()
    catalog = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    items = load()
    rows = offers(catalog, items, day)
    same = {r[1] for r in rows if r[11]}
    anyb = {r[1] for r in rows}
    print(f"{path.name}: {len(catalog)} products -> {len(rows)} offers; basket items found: {len(same)} same brand, "
          f"{len(anyb)} any brand (of {len(items)})")
    if a.out:
        write_csv(a.out, rows)
    else:
        with connect() as conn:
            prepare(conn, items)
        save(rows)


if __name__ == "__main__":
    main()
