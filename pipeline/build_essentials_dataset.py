"""Combine one day's Essentials Basket offer files (Google Shopping + retailer sites) into a dataset workbook.

Same rules as analyst.essentials_prices / essentials_index: Checkers Sixty60 counts as Checkers; offers outside 0.5-2x
the item's median price (usually multipacks or the wrong size) are left out; 'same brand' = cheapest offer of the exact
brand and size, 'cheapest equivalent' = cheapest offer of any brand of the same type and size.

    python build_essentials_dataset.py 2026-11-21     -> data/essentials/essentials_basket_2026-11-21.xlsx
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from fetch_essentials import ROOT, classify, load

LOW, HIGH = 0.5, 2.0   # same band as analyst.essentials_prices
day = sys.argv[1]
files = sorted((ROOT / "data" / "essentials").glob(f"*_{day}.csv"))
basket = {it["item"]: it for it in load()}
offers = []
for p in files:
    with open(p, newline="") as fh:
        for r in csv.DictReader(fh):
            if r["item"] not in basket or not r["price"] or r["channel"] == "other online store":
                continue
            r["source"] = "Retailer website" if r["query"].startswith("site:") else "Google Shopping"
            r["retailer"] = "Checkers" if r["retailer"] == "Checkers Sixty60" else r["retailer"]
            r["price"] = float(r["price"])
            r["same"], r["any"] = classify(r["title"], basket[r["item"]])   # today's rules, also for files saved earlier
            if r["any"]:
                offers.append(r)

med = {i: median([o["price"] for o in offers if o["item"] == i]) for i in {o["item"] for o in offers}}
kept = [o for o in offers if LOW * med[o["item"]] <= o["price"] <= HIGH * med[o["item"]]]
# one row per offer: the same product can come back from several searches, keep it once
seen, uniq = set(), []
for o in sorted(kept, key=lambda o: (o["item"], o["retailer"], o["price"])):
    k = (o["item"], o["retailer"], o["title"].lower(), o["price"])
    if k not in seen:
        seen.add(k); uniq.append(o)

cells = defaultdict(list)
for o in uniq:
    cells[(o["item"], o["retailer"])].append(o)
prices = []
for (item, ret), os_ in sorted(cells.items()):
    same = [o for o in os_ if o["same"]]
    cheap = min(os_, key=lambda o: o["price"])
    sb = min(same, key=lambda o: o["price"]) if same else None
    prices.append({"item": item, "category": basket[item]["category"], "retailer": ret, "channel": cheap["channel"],
                   "same_brand_price": sb["price"] if sb else None, "same_brand_title": sb["title"] if sb else None,
                   "cheapest_equivalent_price": cheap["price"], "cheapest_equivalent_title": cheap["title"],
                   "saving_zar": round(sb["price"] - cheap["price"], 2) if sb else None,
                   "saving_pct": round(100 * (sb["price"] - cheap["price"]) / sb["price"]) if sb else None,
                   "offers": len(os_), "source": " + ".join(sorted({o["source"] for o in os_}))})

mb = {i: median([p["same_brand_price"] for p in prices if p["item"] == i and p["same_brand_price"]] or [0]) for i in basket}
mc = {i: median([p["cheapest_equivalent_price"] for p in prices if p["item"] == i] or [0]) for i in basket}
idx = []
for ret in sorted({p["retailer"] for p in prices}):
    ps = [p for p in prices if p["retailer"] == ret]
    sb = [p["same_brand_price"] / mb[p["item"]] for p in ps if p["same_brand_price"] and mb[p["item"]]]
    ce = [p["cheapest_equivalent_price"] / mc[p["item"]] for p in ps if mc[p["item"]]]
    idx.append({"retailer": ret, "channel": ps[0]["channel"], "items_same_brand": len(sb), "items_any_brand": len(ps),
                "basket_items": len(basket), "same_brand_index": round(100 * sum(sb) / len(sb), 1) if sb else None,
                "cheapest_equivalent_index": round(100 * sum(ce) / len(ce), 1) if ce else None,
                "source": " + ".join(sorted({s for p in ps for s in p["source"].split(" + ")}))})
idx.sort(key=lambda r: -r["items_any_brand"])

wb = Workbook()
def sheet(ws, rows, note):
    ws.append([note]); ws["A1"].font = Font(italic=True)
    cols = list(rows[0].keys()) if rows else []
    ws.append(cols)
    for c in ws[2]: c.font = Font(bold=True)
    for r in rows: ws.append([r[c] for c in cols])
    ws.freeze_panes = "A3"
    for i, c in enumerate(cols, 1):
        ws.column_dimensions[get_column_letter(i)].width = min(48, max(10, len(c) + 2, *[len(str(r[c] or "")) + 1 for r in rows[:300]]))

ws = wb.active; ws.title = "Retailer index"
sheet(ws, idx, f"{day}. Index: 100 = the item's median price across retailers; below 100 = cheaper. Minimum sample: compare a retailer only on 20+ items.")
sheet(wb.create_sheet("Prices"), prices, f"{day}. One row per item and retailer. Regular shelf prices (member and promo prices excluded).")
sheet(wb.create_sheet("Offers"), [{"day": o["day"], "item": o["item"], "category": basket[o["item"]]["category"], "retailer": o["retailer"],
                                   "channel": o["channel"], "title": o["title"], "price": o["price"], "same_brand": o["same"],
                                   "any_brand": o["any"], "source": o["source"]} for o in uniq],
      f"{day}. Every matched offer kept after the size/multipack check.")
missing = [{"item": i, "category": it["category"], "retailers_found": len({p["retailer"] for p in prices if p["item"] == i})}
           for i, it in basket.items()]
sheet(wb.create_sheet("Coverage"), sorted(missing, key=lambda r: r["retailers_found"]), f"{day}. Retailers found per basket item.")
out = ROOT / "data" / "essentials" / f"essentials_basket_{day}.xlsx"
wb.save(out)
print(f"{len(uniq)} offers, {len(prices)} item-retailer prices, {len(idx)} retailers -> {out}")
for r in idx[:14]:
    print(f'  {r["retailer"]:<22} same brand {r["items_same_brand"]:>3}  any brand {r["items_any_brand"]:>3}  '
          f'index {r["same_brand_index"]} / {r["cheapest_equivalent_index"]}  ({r["source"]})')
