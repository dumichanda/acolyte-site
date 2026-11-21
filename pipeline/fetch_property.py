"""SA property dataset: Private Property listings and stock counts via the Scrappa API.

Each run:
  1. refreshes the location tree (9 provinces -> ~48 regions) once a week,
  2. records the full number of listings per province and region (sale/rent, residential; commercial per province),
  3. samples pages (20 listings each) per region and deal type so each region's 30-day sample reaches a median within
     +-PROPERTY_MARGIN_PCT (default 10%) at 90% confidence, from its own price spread; pages rotate daily so the sample
     grows; spare budget follows each region's share of listings (PROPERTY_BUDGET_PCT % of the run), upserting listings and
     their asking price for the day,
  4. records the public bond rate.

Every call costs 1 Scrappa credit (failed calls are free) and is logged in fetch_log (source 'privateproperty').
Budget: SCRAPPA_MAX_CALLS_PER_RUN (default 400) and SCRAPPA_MONTHLY_BUDGET (default 15000).
Skips itself when SCRAPPA_API_KEY is not set.

    python fetch_property.py [--max-calls 400]
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from db import connect, fresh

BASE = "https://scrappa.co/api/privateproperty/"
PORTAL = "privateproperty"
CATEGORY_NAMES = {1: "residential", 2: "commercial", 3: "farm"}


class Budget(Exception):
    pass


class Client:
    def __init__(self, key: str, max_calls: int):
        self.key, self.left, self.used = key, max_calls, 0
        self.log: list[tuple] = []

    def get(self, path: str, params: dict, term: str = "", page: int | None = None) -> dict | None:
        if self.left <= 0:
            raise Budget()
        self.left -= 1
        url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"X-API-KEY": self.key, "Accept": "application/json",
                                                           "User-Agent": "acolyte-pipeline/1.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    d = json.load(r)
                self.used += 1
                n = len(d.get("results") or d.get("shapes") or [])
                self.log.append((term or path, page, n, "ok"))
                return d
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                self.log.append((term or path, page, 0, f"http {e.code}"))
                return None
            except Exception as e:  # network
                if attempt < 2:
                    time.sleep(2)
                    continue
                self.log.append((term or path, page, 0, f"error {type(e).__name__}"))
                return None


def num(v) -> float | None:
    """'2 632 m²' -> 2632; 3.5 -> 3.5; None -> None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.,]", "", str(v).replace(" ", "").replace(" ", "")).replace(",", ".")
    try:
        return float(s) if s else None
    except ValueError:
        return None


def listing_row(r: dict, deal: str, category: str, province: str, region: str | None) -> tuple:
    st = r.get("listingStatuses") or {}
    lp = r.get("listingPrice") or {}
    at = r.get("propertyAttributes") or {}
    off = (r.get("listingAdvertiser") or {}).get("office") or {}
    price = lp.get("price") or None
    if lp.get("isPoa"):
        price = None
    parking = (num(at.get("openParkings")) or 0) + (num(at.get("coveredParkings")) or 0) or None
    url = r.get("shareUrl") or ""
    url = url.split("?")[0] or (f"https://www.privateproperty.co.za/ld/{r.get('portalRef')}" if r.get("portalRef") else None)
    return (PORTAL, r["listingId"], r.get("portalRef"), deal, category, province, region, r.get("propertySuburbName"),
            r.get("propertyTypeDescription"), r.get("propertyTitle"), price, lp.get("priceType"),
            bool(lp.get("isPoa")), bool(lp.get("isOnAuction")),
            num(at.get("beds")), num(at.get("baths")), num(at.get("garages")), parking,
            num(at.get("floorArea")), num(at.get("landArea")),
            (off.get("agencyName") or "").strip() or None, (off.get("officeName") or "").strip() or None,
            bool(st.get("isNew")), bool(st.get("isPriceReduced")), bool(st.get("isOfferPending")), bool(st.get("isSold")),
            url)


UPSERT = """INSERT INTO property.listings AS l (portal, listing_id, portal_ref, deal_type, category, province, region, suburb,
        property_type, title, price, price_type, is_poa, on_auction, beds, baths, garages, parking, floor_m2, land_m2,
        agency, office, is_new, price_reduced, offer_pending, is_sold, url, first_price)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    ON CONFLICT (portal, listing_id) DO UPDATE SET
        price = EXCLUDED.price, price_type = EXCLUDED.price_type, is_poa = EXCLUDED.is_poa,
        on_auction = EXCLUDED.on_auction, is_new = EXCLUDED.is_new, price_reduced = EXCLUDED.price_reduced,
        offer_pending = EXCLUDED.offer_pending, is_sold = EXCLUDED.is_sold, agency = EXCLUDED.agency,
        office = EXCLUDED.office, last_seen = current_date,
        region = COALESCE(l.region, EXCLUDED.region),
        first_price = COALESCE(l.first_price, EXCLUDED.first_price)"""


def refresh_locations(conn, c: Client) -> None:
    fresh = conn.execute("""SELECT count(*) FROM property.locations WHERE portal = %s
                            AND updated_at > now() - interval '7 days'""", (PORTAL,)).fetchone()[0]
    if fresh:
        return
    provs = (c.get("locations/children", {"shape_id": 1}, "locations") or {}).get("shapes") or []
    rows = [(PORTAL, p["id"], p["name"], 1, p["name"]) for p in provs]
    for p in provs:
        for r in (c.get("locations/children", {"shape_id": p["id"]}, "locations") or {}).get("shapes") or []:
            rows.append((PORTAL, r["id"], r["name"], 2, p["name"]))
    with conn.cursor() as cur:
        cur.executemany("""INSERT INTO property.locations (portal, location_id, name, level, province) VALUES (%s,%s,%s,%s,%s)
                           ON CONFLICT (portal, location_id) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level,
                           province = EXCLUDED.province, updated_at = now()""", rows)
    conn.commit()
    print(f"Locations: {len(provs)} provinces, {len(rows) - len(provs)} regions.")


Z90 = 1.645            # 90% confidence
MEDIAN_SE = 1.25       # a median's standard error is about 1.25x a mean's


def needed_listings(cv: float, population: int, margin: float) -> int:
    """Listings needed for a median within +-margin at 90% confidence, given the price spread (coefficient of
    variation) and the region's total listings (finite-population correction: never more than exist)."""
    n0 = (Z90 * MEDIAN_SE * cv / margin) ** 2
    return int(-(-n0 // (1 + (n0 - 1) / population))) if population else int(-(-n0 // 1))


def share_pages(regions: list[tuple], last: dict, allowed: int, fixed_calls: int, spread: dict | None = None,
                have: dict | None = None) -> dict:
    """Pages per (region, deal). Property spends PROPERTY_BUDGET_PCT % of the run's allowance:
    1. page 1 for every region (it also gives the region's listing count);
    2. pages to close the gap between the listings already in its 30-day sample (have) and what it needs for a median
       within +-PROPERTY_MARGIN_PCT at 90% confidence, from its own price spread (spread[(region, deal)] = coefficient of variation; regions with no history use the median spread);
       if the budget can't cover every region's need, each gets the same % of its need;
    3. anything left in proportion to each region's share of all listings.
    Never more pages than a region has."""
    pct = float(os.environ.get("PROPERTY_BUDGET_PCT", "80")) / 100
    margin = float(os.environ.get("PROPERTY_MARGIN_PCT", "10")) / 100
    budget = max(len(regions), int(allowed * pct) - fixed_calls - 2)          # 2 = location refresh and bond rate
    spread = spread or {}
    known = sorted(v for v in spread.values() if v)
    typical = known[len(known) // 2] if known else 0.8
    n = {(r[0], r[4]): last.get((r[0], r[4])) or 0 for r in regions}
    room = {k: max(0, -(-v // 20) - 1) if v else 0 for k, v in n.items()}   # pages beyond page 1 that exist
    pages = {k: 1 for k in n}
    have = have or {}
    # extra pages (beyond page 1, which mostly repeats listings already seen) to close the gap
    need = {k: min(room[k], max(0, -(-(needed_listings(spread.get(k) or typical, n[k], margin) - have.get(k, 0)) // 20)))
            for k in n}
    extra = budget - len(n)
    if extra > 0 and sum(need.values()):
        f = min(1.0, extra / sum(need.values()))                               # same % of need for every region
        for k in n:
            pages[k] += int(need[k] * f)
    left = budget - sum(pages.values())
    total = sum(n.values()) or 1
    if left > 0:                                                               # 3. the rest by share of listings
        want = {k: left * v / total for k, v in n.items()}
        for k in n:
            pages[k] += min(room[k] - (pages[k] - 1), int(want[k]))
        left = budget - sum(pages.values())
        for k in sorted(n, key=lambda k: want[k] - int(want[k]), reverse=True):
            if left <= 0:
                break
            if pages[k] - 1 < room[k]:
                pages[k] += 1
                left -= 1
    met = sum(1 for k in n if pages[k] - 1 >= need[k])
    ok = sum(1 for k in n if have.get(k, 0) >= needed_listings(spread.get(k) or typical, n[k], margin))
    print(f"Property sample (90% confidence, ±{margin:.0%}): {ok}/{len(n)} region-deals already meet the target on their "
          f"30-day sample; today's {budget} pages close the gap for {met}/{len(n)}.")
    return pages


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-calls", type=int, default=int(os.environ.get("SCRAPPA_MAX_CALLS_PER_RUN", "400")))
    a = ap.parse_args()
    key = os.environ.get("SCRAPPA_API_KEY", "")
    if not key:
        print("SCRAPPA_API_KEY not set; skipping the property dataset.")
        return

    with connect() as conn:
        conn.execute((__import__("pathlib").Path(__file__).resolve().parent.parent / "db" / "property.sql").read_text())
        if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'analyst_reader'").fetchone():
            conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_reader")  # new property views
        conn.commit()
        monthly = int(os.environ.get("SCRAPPA_MONTHLY_BUDGET", "15000"))
        used = conn.execute("""SELECT count(*) FROM fetch_log WHERE source = %s AND status = 'ok'
                               AND run_at >= date_trunc('month', now())""", (PORTAL,)).fetchone()[0]
        allowed = min(a.max_calls, monthly - used)
        print(f"Scrappa calls this month: {used}/{monthly}. Allowed this run: {max(allowed, 0)}.")
        if allowed <= 0:
            return
        c = Client(key, allowed)
        today = date.today()
        listings: dict[int, tuple] = {}
        stock: list[tuple] = []
        try:
            refresh_locations(conn, c)
            locs = conn.execute("SELECT location_id, name, level, province FROM property.locations WHERE portal = %s "
                                "ORDER BY level, province, name", (PORTAL,)).fetchall()

            br = c.get("reference/bond-rate", {}, "bond-rate")
            if br and br.get("interest_rate"):
                conn.execute("INSERT INTO property.bond_rate VALUES (%s, %s) ON CONFLICT (day) DO UPDATE SET rate = EXCLUDED.rate",
                             (today, br["interest_rate"]))
            conn.commit()

            # Jobs: (location, deal, category, page). Page 1 of each region also gives the region's stock count.
            jobs = []
            for loc_id, name, level, prov in locs:
                if level == 1:
                    for deal in ("sale", "rent"):
                        jobs.append((loc_id, name, level, prov, deal, "residential", 0))   # count only
                        jobs.append((loc_id, name, level, prov, deal, "commercial", 0))
            # Pages per region follow its share of all listings (last stock count), no fixed tiers: property spends
            # PROPERTY_BUDGET_PCT % of this run's allowance; every region gets page 1 (it also gives the stock count) and
            # the rest is shared out in proportion to each region's % of listings, never more pages than it has listings.
            last = {(r[0], r[1]): r[2] for r in conn.execute(
                """SELECT DISTINCT ON (location_id, deal_type) location_id, deal_type, listings FROM property.stock
                   WHERE portal = %s AND category = 'residential' ORDER BY location_id, deal_type, day DESC""", (PORTAL,))}
            regions = [(loc_id, name, level, prov, deal) for loc_id, name, level, prov in locs if level == 2
                       for deal in ("sale", "rent")]
            # price spread per region and deal over the last 30 days (coefficient of variation of asking prices)
            names = {r[0]: r[1] for r in regions}
            cv = {(r[0], r[1]): r[2] for r in conn.execute(
                """SELECT l.location_id, s.deal_type, stddev(s.price) / NULLIF(avg(s.price), 0)
                   FROM property.listings s JOIN property.locations l ON l.portal = s.portal AND l.name = s.region
                   WHERE s.portal = %s AND s.category = 'residential' AND s.price > 0 AND NOT coalesce(s.is_poa, false)
                     AND s.last_seen >= current_date - 30
                   GROUP BY 1, 2 HAVING count(*) >= 5""", (PORTAL,))} if names else {}
            have = {(r[0], r[1]): r[2] for r in conn.execute(
                """SELECT l.location_id, s.deal_type, count(*) FROM property.listings s
                   JOIN property.locations l ON l.portal = s.portal AND l.name = s.region
                   WHERE s.portal = %s AND s.category = 'residential' AND s.last_seen >= current_date - 30
                   GROUP BY 1, 2""", (PORTAL,))} if names else {}
            pages = share_pages(regions, last, allowed, len(jobs), {k: float(v) for k, v in cv.items() if v}, have)
            # Page 1 every day (newest listings and the stock count); the other pages rotate through the region's whole
            # list day by day, so the 30-day sample keeps growing instead of re-reading the same pages.
            order = []
            for loc_id, name, level, prov, deal in regions:
                k, total_pages = (loc_id, deal), max(1, -(-(last.get((loc_id, deal)) or 0) // 20))
                p = pages[k]
                start = (today.toordinal() * max(p - 1, 1)) % max(total_pages - 1, 1)
                seq = [1] + [2 + (start + i) % max(total_pages - 1, 1) for i in range(p - 1)] if total_pages > 1 else [1]
                order += [(i, (loc_id, name, level, prov, deal, "residential", pg)) for i, pg in enumerate(dict.fromkeys(seq))]
            jobs += [j for _, j in sorted(order, key=lambda x: x[0])]                    # breadth first over regions
            print(f"Property: {len(jobs)} searches planned (pages per region follow its share of listings; busiest region {max(pages.values(), default=0)} pages, rotating daily).")

            def run(job):
                loc_id, name, level, prov, deal, cat, page = job
                p = {"type": cat, "deal_type": deal, "location_id": loc_id, "page": max(page, 1)}
                return job, c.get("listings/search", p, f"{cat}/{deal}/{name}", max(page, 1))

            with ThreadPoolExecutor(max_workers=6) as pool:
                for (loc_id, name, level, prov, deal, cat, page), d in pool.map(run, jobs):
                    if not d:
                        continue
                    if page <= 1 and d.get("total_filtered_results") is not None:
                        stock.append((PORTAL, today, loc_id, prov, name if level == 2 else None, deal, cat,
                                      int(d["total_filtered_results"])))
                    if page >= 1:
                        for r in d.get("results") or []:
                            if r.get("listingId"):
                                cat_name = CATEGORY_NAMES.get(r.get("propertyCategory"), cat)
                                listings[r["listingId"]] = listing_row(r, deal, cat_name, prov, name)
        except Budget:
            print("Run call budget reached; saving what was fetched.")

        conn = fresh(conn)   # the fetch took minutes: write on a new connection so nothing paid for is lost
        with conn.cursor() as cur:
            rows = [row + (row[10],) for row in listings.values()]
            cur.executemany(UPSERT, rows)
            cur.executemany("""INSERT INTO property.prices (portal, listing_id, seen_on, price) VALUES (%s,%s,%s,%s)
                               ON CONFLICT DO NOTHING""", [(PORTAL, r[1], today, r[10]) for r in listings.values()])
            cur.executemany("""INSERT INTO property.stock VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                               ON CONFLICT (portal, day, location_id, deal_type, category) DO UPDATE SET listings = EXCLUDED.listings""",
                            stock)
            cur.executemany("INSERT INTO fetch_log (source, search_term, page, results, status) VALUES (%s,%s,%s,%s,%s)",
                            [(PORTAL, t[:200], p, n, s) for t, p, n, s in c.log])
        conn.commit()
        total = conn.execute("SELECT count(*) FROM property.listings").fetchone()[0]
        print(f"Property: {len(listings)} listings seen, {len(stock)} stock counts, {c.used} calls. "
              f"{total} listings tracked in total.")


if __name__ == "__main__":
    main()
