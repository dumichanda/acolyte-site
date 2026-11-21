"""Find each Essentials Basket item's Pick n Pay product pages with a Google web search (site:pnp.co.za), so the browser
opens only those pages instead of browsing whole categories. Product pages are allowed by the site's robots.txt.

Links are kept in data/essentials/pnp_links.csv and reused on later runs (product pages rarely move); only items with no
saved link are searched again. Up to PER_ITEM links per item: the exact brand plus the alternatives Google lists with it.

    python pnp_links.py [--refresh] [--per-item 4]
"""
import argparse
import csv
import os
import re
from concurrent.futures import ThreadPoolExecutor

import scrappa
from fetch_essentials import ROOT, load

OUT = ROOT / "data" / "essentials" / "pnp_links.csv"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="search every item again")
    ap.add_argument("--per-item", type=int, default=4)
    ap.add_argument("--max-calls", type=int, default=int(os.environ.get("PNP_LINK_CALLS", "150")))
    a = ap.parse_args()
    items = load()
    saved: dict[str, list[str]] = {}
    if OUT.exists() and not a.refresh:
        with open(OUT, newline="") as f:
            for r in csv.DictReader(f):
                saved.setdefault(r["item"], []).append(r["url"])
    todo = [it for it in items if it["item"] not in saved]
    c = scrappa.Client("google_search", a.max_calls)

    def find(it):
        try:
            d = c.get("search", {"query": f'site:pnp.co.za {it["query"]}', "gl": "za", "hl": "en"}, f'pnp links: {it["item"]}')
        except scrappa.Budget:
            return it, []
        links = []
        for r in (d or {}).get("organic_results") or []:
            u = (r.get("link") or "").split("?")[0]
            if re.match(r"^https://www\.pnp\.co\.za/[^/]+/p/[0-9]+_(?!CS)[A-Z]+$", u) and u not in links:
                links.append(u)
        return it, links[: a.per_item]

    with ThreadPoolExecutor(max_workers=4) as pool:
        for it, links in pool.map(find, todo):
            saved[it["item"]] = links
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "url"])
        for it in items:
            for u in saved.get(it["item"], []):
                w.writerow([it["item"], u])
    found = sum(1 for it in items if saved.get(it["item"]))
    print(f"Pick n Pay links: {c.used} searches; {found}/{len(items)} items have product pages; "
          f"{len({u for v in saved.values() for u in v})} unique pages -> {OUT}")


if __name__ == "__main__":
    main()
