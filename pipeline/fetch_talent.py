"""Talent Analyst extras via Scrappa, kept cheap:

  * Google Jobs and LinkedIn Jobs (SA): a few searches a day, rotating through the role search terms. New ads go into
    `jobs` (source 'google_jobs' / 'linkedin'); ads already in the table under the same title + company are skipped.
  * Glassdoor salary estimates for each role family, South Africa and the biggest provinces, refreshed monthly.
  * Glassdoor employer ratings for the employers with the most open roles, refreshed every 60 days.

Per-run caps: TALENT_JOB_SEARCHES (default 8), TALENT_SALARY_CALLS (default 15), TALENT_RATING_CALLS (default 15).

    python fetch_talent.py
"""
import hashlib
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from psycopg.types.json import Jsonb

from db import connect
from fetch_adzuna import SEARCH_TERMS, UPSERT
from taxonomy import PROVINCES
import scrappa

ROOT = Path(__file__).resolve().parent.parent

# Representative job title per role family (Glassdoor salary search).
SALARY_TITLES = {
    "Data Capture": "data capturer", "Creditors & Debtors": "creditors clerk", "Collections": "collections agent",
    "Claims Administration": "claims administrator", "Payroll": "payroll administrator", "Compliance & FICA": "compliance officer",
    "Conveyancing & Legal Admin": "conveyancing secretary", "Tender Administration": "tender administrator",
    "Customer Service & Call Centre": "call centre agent", "Sales Admin & Quoting": "sales administrator",
    "Logistics & Stock Admin": "logistics coordinator", "Bookkeeping & Accounts Admin": "bookkeeper",
    "Reporting & Data Analysis": "data analyst", "HR & Recruitment Admin": "hr administrator",
    "Office & Admin Support": "administrative assistant",
}
# Glassdoor location ids (from /glassdoor/locations/search).
LOCATIONS = [("South Africa", "COUNTRY", 211), ("Gauteng", "STATE", 6781), ("Western Cape", "STATE", 6786),
             ("KwaZulu-Natal", "STATE", 6778), ("Eastern Cape", "STATE", 6780), ("Free State", "STATE", 6779),
             ("Limpopo", "STATE", 6784), ("Mpumalanga", "STATE", 6782), ("North West", "STATE", 6785),
             ("Northern Cape", "STATE", 6783)]

CITY_PROVINCE = {
    "johannesburg": "Gauteng", "sandton": "Gauteng", "pretoria": "Gauteng", "centurion": "Gauteng", "midrand": "Gauteng",
    "randburg": "Gauteng", "roodepoort": "Gauteng", "benoni": "Gauteng", "boksburg": "Gauteng", "germiston": "Gauteng",
    "kempton park": "Gauteng", "alberton": "Gauteng", "soweto": "Gauteng", "vereeniging": "Gauteng", "krugersdorp": "Gauteng",
    "edenvale": "Gauteng", "fourways": "Gauteng", "rosebank": "Gauteng", "springs": "Gauteng", "isando": "Gauteng",
    "cape town": "Western Cape", "bellville": "Western Cape", "stellenbosch": "Western Cape", "paarl": "Western Cape",
    "george": "Western Cape", "somerset west": "Western Cape", "durbanville": "Western Cape", "brackenfell": "Western Cape",
    "durban": "KwaZulu-Natal", "umhlanga": "KwaZulu-Natal", "pietermaritzburg": "KwaZulu-Natal", "pinetown": "KwaZulu-Natal",
    "ballito": "KwaZulu-Natal", "richards bay": "KwaZulu-Natal", "newcastle": "KwaZulu-Natal",
    "port elizabeth": "Eastern Cape", "gqeberha": "Eastern Cape", "east london": "Eastern Cape", "mthatha": "Eastern Cape",
    "bloemfontein": "Free State", "welkom": "Free State", "polokwane": "Limpopo", "mbombela": "Mpumalanga",
    "nelspruit": "Mpumalanga", "witbank": "Mpumalanga", "emalahleni": "Mpumalanga", "rustenburg": "North West",
    "mahikeng": "North West", "potchefstroom": "North West", "kimberley": "Northern Cape", "upington": "Northern Cape",
}


def where(text: str) -> tuple[str | None, str | None]:
    """Province and city from free location text such as 'City of Johannesburg, Gauteng, South Africa'."""
    t = (text or "").lower()
    prov = next((p for p in PROVINCES if p.lower().replace("-", " ") in t.replace("-", " ")), None)
    city = next((c for c in CITY_PROVINCE if c in t), None)
    if city and not prov:
        prov = CITY_PROVINCE[city]
    return prov, (city.title() if city else None)


def ago(text: str) -> datetime | None:
    m = re.search(r"(\d+)\s+(hour|day|week|month)s?\s+ago", text or "")
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    days = {"hour": 0, "day": n, "week": 7 * n, "month": 30 * n}[unit]
    return datetime.now(timezone.utc) - timedelta(days=days)


def key(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def job_row(source, ext_id, title, company, desc, prov, city, salary, posted, url, term, raw):
    smin = smax = None
    if salary:   # 'R 180K–R 300K a year'
        nums = [float(x) * (1000 if k else 1) for x, k in re.findall(r"R\s?([\d.]+)\s?(K)?", salary.replace("\xa0", " "))]
        if nums and "year" in salary:
            smin, smax = nums[0], nums[-1]
        elif nums and "month" in salary:
            smin, smax = nums[0] * 12, nums[-1] * 12
    jid = f"{source}:{hashlib.sha1((ext_id or url or title + (company or '')).encode()).hexdigest()[:16]}"
    return (jid, source, False, title[:300], company, desc, prov, city, None, None, None, smin, smax, False, posted, url, term, Jsonb(raw))


def fetch_jobs(conn, c_g: scrappa.Client, c_l: scrappa.Client, searches: int) -> int:
    seen = {(key(t), key(co)) for t, co in conn.execute(
        "SELECT title, company FROM jobs WHERE posted_at IS NULL OR posted_at >= now() - interval '60 days'")}
    # Rotate: day number picks which terms run today.
    n = len(SEARCH_TERMS)
    start = (date.today().toordinal() * max(1, searches // 2)) % n
    terms = [SEARCH_TERMS[(start + i) % n] for i in range(max(1, searches // 2))]
    rows = []
    for term in terms:
        d = c_g.get("google/jobs", {"q": term, "gl": "za", "google_domain": "google.co.za"}, f"google jobs: {term}")
        for j in (d or {}).get("jobs_results") or []:
            title, co = (j.get("title") or "").strip(), (j.get("company_name") or "").strip() or None
            if not title or (key(title), key(co)) in seen:
                continue
            ext = j.get("extensions") or []
            prov, city = where(j.get("location") or "")
            posted = ago(" ".join(ext))
            salary = next((e for e in ext if "R" in e and ("year" in e or "month" in e)), None)
            rows.append(job_row("google_jobs", j.get("job_id"), title, co, f"Via {j.get('via') or 'Google Jobs'}.",
                                prov, city, salary, posted or datetime.now(timezone.utc), j.get("share_link"), term, j))
            seen.add((key(title), key(co)))
        d = c_l.get("linkedin/jobs/search", {"query": f"{term} South Africa", "gl": "za", "cr": "countryZA", "num": 20,
                                             "dateRestrict": "m1"}, f"linkedin: {term}")
        for r in (d or {}).get("organic_results") or []:
            link = r.get("link") or ""
            if "/jobs/view/" not in link:
                continue
            head = re.sub(r"\s*-\s*(Jobs\s*-\s*)?LinkedIn.*$", "", r.get("title") or "").strip()
            m = re.match(r"(.+?)\s+at\s+(.+)$", head) or re.match(r"(.+?)\s+-\s+(.+)$", head)
            title, co = (m.group(1), m.group(2)) if m else (head, None)
            title, co = title.strip(" .…"), (co or "").strip(" .…") or None
            if not title or (key(title), key(co)) in seen:
                continue
            snip = r.get("snippet") or ""
            prov, city = where(snip)
            dm = re.match(r"(\d{1,2} \w{3,9} \d{4})", snip)
            try:
                posted = datetime.strptime(dm.group(1), "%d %b %Y").replace(tzinfo=timezone.utc) if dm else ago(snip)
            except ValueError:
                posted = ago(snip)
            rows.append(job_row("linkedin", link.split("?")[0], title, co, snip[:600], prov, city, None,
                                posted or datetime.now(timezone.utc), link.split("?")[0], term, r))
            seen.add((key(title), key(co)))
    with conn.cursor() as cur:
        cur.executemany(UPSERT, rows)
    conn.commit()
    return len(rows)


def fetch_salaries(conn, c: scrappa.Client) -> int:
    fresh = {(t, l) for t, l in conn.execute(
        "SELECT job_title, location_id FROM talent.salary_benchmarks WHERE fetched_at > now() - interval '30 days'")}
    n = 0
    for loc, ltype, lid in LOCATIONS:            # national first, then provinces
        for fam, title in SALARY_TITLES.items():
            if (title, lid) in fresh:
                continue
            p = {"job_title": title, ("country_id" if ltype == "COUNTRY" else "state_id"): lid}
            if ltype == "STATE":
                p["country_id"] = 211
            d = c.get("glassdoor/salaries/estimate", p, f"salary: {title} / {loc}")
            e = ((d or {}).get("data") or {}).get("estimate") or {}
            b, tp = e.get("base_pay_percentiles") or {}, e.get("total_pay_percentiles") or {}
            conn.execute("""INSERT INTO talent.salary_benchmarks (job_title, role_family, location, location_type, location_id,
                                currency, pay_period, base_p10, base_p25, base_p50, base_p75, base_p90, total_p50, salaries_count,
                                confidence) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON CONFLICT (job_title, location_id) DO UPDATE SET base_p10 = EXCLUDED.base_p10,
                                base_p25 = EXCLUDED.base_p25, base_p50 = EXCLUDED.base_p50, base_p75 = EXCLUDED.base_p75,
                                base_p90 = EXCLUDED.base_p90, total_p50 = EXCLUDED.total_p50, salaries_count = EXCLUDED.salaries_count,
                                confidence = EXCLUDED.confidence, currency = EXCLUDED.currency, pay_period = EXCLUDED.pay_period,
                                fetched_at = now()""",
                         (title, fam, loc, ltype, lid, e.get("currency"), e.get("pay_period"), b.get("p10"), b.get("p25"),
                          b.get("p50"), b.get("p75"), b.get("p90"), tp.get("p50"), e.get("salaries_count"), e.get("confidence")))
            if b.get("p50"):
                conn.execute("""INSERT INTO talent.salary_history VALUES (%s,%s,%s,%s,current_date,%s,%s,%s,%s,%s)
                                ON CONFLICT DO NOTHING""", (title, lid, loc, fam, b.get("p25"), b.get("p50"), b.get("p75"),
                                                           tp.get("p50"), e.get("salaries_count")))
            conn.commit()
            n += 1
    return n


def fetch_ratings(conn, c: scrappa.Client, limit: int) -> int:
    todo = conn.execute("""
        SELECT c.id, c.name FROM companies c JOIN jobs j ON j.company_id = c.id
        WHERE NOT c.is_recruiter AND NOT COALESCE(c.is_foreign, FALSE)
          AND NOT EXISTS (SELECT 1 FROM talent.employer_ratings r WHERE r.company = c.name AND r.fetched_at > now() - interval '60 days')
        GROUP BY c.id, c.name ORDER BY count(*) DESC LIMIT %s""", (limit,)).fetchall()
    n = 0
    for cid, name in todo:
        d = c.get("glassdoor/companies/search", {"query": name[:100], "limit": 5}, f"rating: {name}")
        cands = ((d or {}).get("data") or {}).get("companies") or []
        want = key(re.sub(r"\b(pty|ltd|limited|inc|group|holdings|sa|south africa)\b", "", name.lower()))
        best = next((x for x in cands if want and (key(x.get("name")) == want or key(x.get("name")).startswith(want + " ")
                     or want.startswith(key(x.get("name")) + " ")) and (x.get("review_count") or 0) > 0), None)
        conn.execute("""INSERT INTO talent.employer_ratings (company, company_id, glassdoor_id, glassdoor_name, rating, review_count,
                            salary_count, url, matched) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (company) DO UPDATE SET glassdoor_id = EXCLUDED.glassdoor_id, glassdoor_name = EXCLUDED.glassdoor_name,
                            rating = EXCLUDED.rating, review_count = EXCLUDED.review_count, salary_count = EXCLUDED.salary_count,
                            url = EXCLUDED.url, matched = EXCLUDED.matched, fetched_at = now()""",
                     (name, cid, (best or {}).get("id"), (best or {}).get("name"), (best or {}).get("rating"),
                      (best or {}).get("review_count"), (best or {}).get("salary_count"), (best or {}).get("url"), bool(best)))
        if best:
            conn.execute("INSERT INTO talent.rating_history VALUES (%s, current_date, %s, %s) ON CONFLICT DO NOTHING",
                         (name, best.get("rating"), best.get("review_count")))
        conn.commit()
        n += 1
    return n


def main() -> None:
    if not scrappa.key():
        print("SCRAPPA_API_KEY not set; skipping talent extras.")
        return
    searches = int(os.environ.get("TALENT_JOB_SEARCHES", "16"))
    sal = int(os.environ.get("TALENT_SALARY_CALLS", "30"))
    rat = int(os.environ.get("TALENT_RATING_CALLS", "25"))
    with connect() as conn:
        conn.execute((ROOT / "db" / "talent.sql").read_text())
        if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = 'analyst_reader'").fetchone():
            conn.execute("GRANT SELECT ON ALL TABLES IN SCHEMA analyst TO analyst_reader")
        conn.commit()
        left = scrappa.allowance(conn, searches + sal + rat)
        if not left:
            return
        g, l = scrappa.Client("google_jobs", searches // 2), scrappa.Client("linkedin_jobs", searches - searches // 2)
        s, r = scrappa.Client("glassdoor", min(sal, left)), scrappa.Client("glassdoor", min(rat, left))
        out = {}
        for name, fn in (("jobs", lambda: fetch_jobs(conn, g, l, searches)), ("salaries", lambda: fetch_salaries(conn, s)),
                         ("ratings", lambda: fetch_ratings(conn, r, rat))):
            try:
                out[name] = fn()
            except scrappa.Budget:
                out[name] = "budget reached"
                conn.commit()
        for c in (g, l, s, r):
            c.save_log(conn)
        conn.commit()
        print(f"Talent: {out} · credits used {g.used + l.used + s.used + r.used}")


if __name__ == "__main__":
    main()
