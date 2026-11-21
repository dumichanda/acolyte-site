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
from fetch_essentials import classify, load, prepare, save, write_csv
from fetch_retail import retailer_of

SITE = {"Pick n Pay": "pnp.co.za"}


def offers(catalog: list[dict], items: list[dict], day: date) -> list[tuple]:
    rows = []
    for p in catalog:
        if not p.get("price") or p.get("in_stock") is False:
            continue
        retailer, channel = retailer_of(p["retailer"])
        for it in items:
            sku, gen = classify(p["title"], it)
            if gen:
                rows.append((day, it["item"], f'site:{p["code"]}', p["retailer"], retailer, channel, p["title"][:300],
                             float(p["price"]), None, None, None, sku, f'site:{SITE.get(p["retailer"], p["retailer"])}', gen))
    return rows


def save_links(path: str, rows: list[tuple], catalog: list[dict], items: list[dict], per_item: int = 3) -> None:
    """Keep links already saved for items this catalogue didn't find; replace the rest with today's best matches."""
    import csv
    url = {f'site:{p["code"]}': p.get("url") for p in catalog}
    by: dict[str, list[tuple]] = {}
    for r in sorted(rows, key=lambda r: r[7]):
        by.setdefault(r[1], []).append(r)
    old: dict[str, list[str]] = {}
    if Path(path).exists():
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                old.setdefault(r["item"], []).append(r["url"])
    out = []
    for it in items:
        rs = by.get(it["item"], [])
        pick = [r for r in rs if r[11]][:1] + [r for r in rs if not r[11]][: per_item - 1]
        links = [url[r[2]] for r in pick if url.get(r[2])] or old.get(it["item"], [])[:per_item]
        out += [(it["item"], u) for u in dict.fromkeys(links)]
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "url"])
        w.writerows(out)
    print(f"Saved {len(out)} product pages for {len({i for i, _ in out})} items -> {path}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("catalog")
    ap.add_argument("--out")
    ap.add_argument("--day", default="")
    ap.add_argument("--links-out", help="also save the product pages worth re-checking (per item: cheapest same brand + "
                                        "the 2 cheapest equivalents), so later runs open only those pages")
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
    if a.links_out:
        save_links(a.links_out, rows, catalog, items)
    if a.out:
        write_csv(a.out, rows)
    else:
        with connect() as conn:
            prepare(conn, items)
        save(rows)


if __name__ == "__main__":
    main()
