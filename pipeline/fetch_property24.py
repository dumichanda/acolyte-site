"""Property24 (via Scrappa): newest listings and full stock counts for South Africa's main cities.

Sorting by newest gives an unbiased daily flow of new listings (unlike the first-page sample on Private Property),
so 'new listings per day', asking prices of new stock and agency share of new mandates become reliable.
Listings go into property.listings / property.prices with portal 'property24'; city counts into property.stock.

Per run: 2 deal types x P24_PAGES pages (default 1, 21 listings each) for each city in CITIES, plus a one-off
location lookup per city. Agent names are not stored (POPIA); only the agency brand and branch.

    python fetch_property24.py [--pages 1]
"""
import argparse
import os
import re
from datetime import date
from pathlib import Path

from db import connect
import scrappa

ROOT = Path(__file__).resolve().parent.parent
PORTAL = "property24"

CITIES = ["Johannesburg", "Pretoria", "Cape Town", "Durban", "Centurion", "Sandton", "Randburg", "Roodepoort", "Midrand",
          "Benoni", "Boksburg", "Germiston", "Kempton Park", "Umhlanga", "Ballito", "Pietermaritzburg", "Stellenbosch",
          "Somerset West", "George", "Port Elizabeth", "East London", "Bloemfontein", "Polokwane", "Nelspruit",
          "Rustenburg", "Kimberley"]

# Agency brands: branch names like 'Rawson Properties Meadowdale' -> 'Rawson'.
BRANDS = [("re/max", "RE/MAX"), ("remax", "RE/MAX"), ("rawson", "Rawson"), ("pam golding", "Pam Golding Properties"),
          ("seeff", "Seeff"), ("harcourts", "Harcourts"), ("century 21", "Century 21"), ("chas everitt", "Chas Everitt"),
          ("just property", "Just Property"), ("leapfrog", "Leapfrog"), ("tyson", "Tyson Properties"),
          ("engel & v", "Engel & Völkers"), ("engel and v", "Engel & Völkers"), ("sotheby", "Sotheby's"),
          ("lew geffen", "Lew Geffen Sotheby's"), ("jawitz", "Jawitz"), ("only realty", "Only Realty"),
          ("wakefields", "Wakefields"), ("homenet", "Homenet"), ("greeff", "Greeff"), ("dogon", "Dogon Group"),
          ("csi property", "CSi Property"), ("homii", "Homii"), ("realnet", "Realnet"), ("fine & country", "Fine & Country"),
          ("aida", "Aida"), ("property junction", "Property Junction"), ("trafalgar", "Trafalgar")]
TYPES = ["Vacant Land", "Townhouse", "Apartment", "House", "Flat", "Cluster", "Duet", "Simplex", "Duplex", "Farm",
         "Smallholding", "Penthouse", "Studio", "Garden Cottage", "Commercial", "Industrial", "Retail", "Office"]


def brand(name: str | None) -> str | None:
    n = (name or "").lower()
    return next((b for k, b in BRANDS if k in n), (name or "").strip() or None)


def ptype(title: str) -> str | None:
    t = title.lower()
    return next((x for x in TYPES if x.lower() in t), None)


def category(pt: str | None) -> str:
    if pt in ("Commercial", "Industrial", "Retail", "Office"):
        return "commercial"
    if pt in ("Farm", "Smallholding"):
        return "farm"
    return "residential"


def city_ids(conn, c: scrappa.Client) -> list[tuple[int, str, str]]:
    have = {r[1]: (r[0], r[1], r[2]) for r in conn.execute(
        "SELECT location_id, name, province FROM property.locations WHERE portal = %s AND level = 2", (PORTAL,))}
    for name in CITIES:
        if name in have:
            continue
        d = c.get("property24/locations/autocomplete", {"q": name}, f"p24 location: {name}") or {}
        hit = next((s for s in d.get("suggestions") or [] if s.get("type") == 2 and s.get("name", "").lower() == name.lower()), None)
        if hit:
            prov = (hit.get("parent_name") or "").replace("Kwazulu Natal", "KwaZulu-Natal").replace("KwaZulu Natal", "KwaZulu-Natal")
            conn.execute("""INSERT INTO property.locations (portal, location_id, name, level, province) VALUES (%s,%s,%s,2,%s)
                            ON CONFLICT (portal, location_id) DO UPDATE SET name = EXCLUDED.name, province = EXCLUDED.province,
                            updated_at = now()""", (PORTAL, hit["id"], hit["name"], prov))
            have[hit["name"]] = (hit["id"], hit["name"], prov)
    conn.commit()
    return [have[n] for n in CITIES if n in have]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=int(os.environ.get("P24_PAGES", "1")))
    ap.add_argument("--cities", type=int, default=0, help="only the first N cities (testing)")
    a = ap.parse_args()
    if not scrappa.key():
        print("SCRAPPA_API_KEY not set; skipping Property24.")
        return
    from fetch_property import UPSERT   # same listing upsert as Private Property
    with connect() as conn:
        conn.execute((ROOT / "db" / "property.sql").read_text())
        conn.commit()
        cap = int(os.environ.get("P24_MAX_CALLS_PER_RUN", "120"))
        c = scrappa.Client("property24", scrappa.allowance(conn, cap))
        today = date.today()
        listings, stock = {}, []
        try:
            cities = city_ids(conn, c)
            if a.cities:
                cities = cities[: a.cities]
            for page in range(1, a.pages + 1):
                for cid, cname, prov in cities:
                    for deal in ("sale", "rent"):
                        d = c.get("property24/search", {"deal_type": deal, "location_id": cid, "location_type": 2,
                                                         "sort": "newest", "page": page}, f"p24 {deal}/{cname}/{page}")
                        if not d:
                            continue
                        if page == 1 and d.get("total_filtered_results") is not None:
                            stock.append((PORTAL, today, cid, prov, cname, deal, "all", int(d["total_filtered_results"])))
                        for r in d.get("results") or []:
                            if not r.get("listing_id"):
                                continue
                            pt = ptype(r.get("title") or "")
                            ag = (r.get("agency") or {}).get("name")
                            lid = int(r["listing_id"])
                            listings[lid] = (PORTAL, lid, str(lid), deal, category(pt), prov, cname, r.get("location"), pt,
                                             r.get("title"), r.get("price"), "PerMonth" if deal == "rent" else None,
                                             r.get("price") is None, False, r.get("bedrooms"), r.get("bathrooms"), None,
                                             r.get("parking_spaces"), r.get("floor_size_m2"), r.get("erf_size_m2"),
                                             brand(ag), ag, page == 1, False, False, False, r.get("url"))
        except scrappa.Budget:
            print("Run call budget reached; saving what was fetched.")
        with conn.cursor() as cur:
            cur.executemany(UPSERT, [row + (row[10],) for row in listings.values()])
            cur.executemany("""INSERT INTO property.prices (portal, listing_id, seen_on, price) VALUES (%s,%s,%s,%s)
                               ON CONFLICT DO NOTHING""", [(PORTAL, r[1], today, r[10]) for r in listings.values()])
            cur.executemany("""INSERT INTO property.stock VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (portal, day, location_id, deal_type, category) DO UPDATE SET listings = EXCLUDED.listings""",
                            stock)
        c.save_log(conn)
        conn.commit()
        print(f"Property24: {len(listings)} newest listings, {len(stock)} city counts, {c.used} calls.")


if __name__ == "__main__":
    main()
