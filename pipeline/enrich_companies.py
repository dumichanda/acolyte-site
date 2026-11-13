"""Find each hiring employer's website, LinkedIn page, published contact inbox and location.

    python pipeline/enrich_companies.py              # up to ENRICH_PER_RUN companies (default 25)
    python pipeline/enrich_companies.py --limit 5

Biggest opportunities first; recruiters are skipped. Only *published, role-based* inboxes such as
info@ or hello@ on the company's own domain are stored, never personal addresses (POPIA). Each company
is tried at most 3 times.
"""
import argparse
import os
import re
from collections import Counter

from db import connect, init_db
from webtools import NOT_COMPANY, domain, fetch, generic_emails, geocode, links, meta_description, phones, search

STOP = {"group", "south", "africa", "african", "sa", "holdings", "services", "solutions", "and", "the", "of", "company",
        "consulting", "management", "trading", "international", "systems", "technologies", "limited", "ltd", "pty"}


def name_tokens(name: str) -> list[str]:
    toks = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if len(t) > 2 and t not in STOP]
    return toks or re.findall(r"[a-z0-9]+", name.lower())[:1]


def pick_website(name: str, results: list[dict]) -> tuple[str | None, str | None]:
    """(website domain, linkedin company URL) from search results; website must contain a name token."""
    toks = name_tokens(name)
    site, li = None, None
    for r in results:
        url, d = r["url"], domain(r["url"])
        if not li and re.search(r"linkedin\.com/company/", url):
            li = url.split("?")[0]
        if site or not d or NOT_COMPANY.search(d):
            continue
        squashed = d.replace("-", "")
        if any(t in squashed for t in toks) or "".join(toks)[:10] in squashed:
            site = d
    return site, li


def guess_website(name: str) -> str | None:
    """No search results (e.g. the search engine blocks CI servers): try likely domains and keep the first whose
    homepage title or description names the company."""
    words = re.findall(r"[a-z0-9]+", re.sub(r"\(.*?\)", "", name.lower()))
    core = [w for w in words if w not in {"pty", "ltd", "limited", "llc", "the", "sa", "south", "africa", "careers"}]
    toks = name_tokens(name)
    if not core:
        return None
    stems = list(dict.fromkeys(["".join(core), "".join(core[:2]), core[0], "-".join(core)]))
    for stem in stems:
        if len(stem) < 4:
            continue
        for tld in (".co.za", ".com", ".africa", ".org.za"):
            d = stem + tld
            page = fetch(f"https://{d}", timeout=8) or fetch(f"https://www.{d}", timeout=8)
            if not page:
                continue
            head = (re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S) or [None, ""])[1] + " " + meta_description(page)
            if any(t in head.lower() for t in toks):
                return d
    return None


def enrich(conn, c: dict) -> str:
    name, site, li = c["name"], c["website"], c["linkedin_url"]
    if not site or not li:
        found_site, found_li = pick_website(name, search(f"{name} South Africa"))
        site, li = site or found_site, li or found_li
        site = site or guess_website(name)
    desc, emails, tel, contact_url = c["description"], [], [], None
    if site:
        home = fetch(f"https://{site}") or fetch(f"http://{site}")
        if home:
            desc = desc or meta_description(home)
            emails += generic_emails(home, site)
            tel += phones(re.sub(r"<[^>]+>", " ", home))
            if not li:
                li = next((u.split("?")[0] for u in links(home, f"https://{site}") if "linkedin.com/company/" in u), None)
            contact_url = next((u for u in links(home, f"https://{site}")
                                if re.search(r"contact", u, re.I) and domain(u).endswith(site)), None)
            if contact_url and not emails:
                page = fetch(contact_url)
                if page:
                    emails += generic_emails(page, site)
                    tel += phones(re.sub(r"<[^>]+>", " ", page))
    # Location: research HQ, else the city where most of their ads are.
    lat, lon, city = c["lat"], c["lon"], c["hq_city"]
    if lat is None:
        if not city:
            row = conn.execute("SELECT city, count(*) FROM jobs WHERE company_id = %s AND city IS NOT NULL "
                               "GROUP BY 1 ORDER BY 2 DESC LIMIT 1", (c["id"],)).fetchone()
            city = row[0] if row else None
        if city:
            ll = geocode(f"{city}, South Africa")
            lat, lon = ll if ll else (None, None)
    conn.execute(
        """UPDATE companies SET website = %s, linkedin_url = %s, description = %s, lat = %s, lon = %s,
                  hq_city = COALESCE(hq_city, %s), enrich_tries = enrich_tries + 1,
                  enriched_at = CASE WHEN %s::text IS NOT NULL THEN now() ELSE enriched_at END,
                  source = COALESCE(source, 'search')
           WHERE id = %s""",
        (site, li, desc or None, lat, lon, city, site, c["id"]),
    )
    for e in dict.fromkeys(emails):
        conn.execute(
            """INSERT INTO contacts (company_id, role, email, phone, is_generic, source)
               VALUES (%s, 'General inbox', %s, %s, TRUE, %s) ON CONFLICT (company_id, email) DO NOTHING""",
            (c["id"], e, tel[0] if tel else None, contact_url or f"https://{site}"),
        )
    if tel and not emails:  # keep the switchboard number even without an inbox
        conn.execute(
            """INSERT INTO contacts (company_id, role, phone, is_generic, source)
               SELECT %s, 'Switchboard', %s, TRUE, %s
               WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE company_id = %s)""",
            (c["id"], tel[0], f"https://{site}", c["id"]),
        )
    conn.commit()
    return f"{name}: site={site or '-'} linkedin={'yes' if li else '-'} inboxes={len(set(emails))} geo={'yes' if lat else '-'}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=int(os.environ.get("ENRICH_PER_RUN", "25")))
    args = ap.parse_args()
    init_db()
    with connect() as conn:
        cur = conn.execute(
            """SELECT c.id, c.name, c.website, c.linkedin_url, c.description, c.hq_city, c.lat, c.lon
               FROM v_company_leads c
               WHERE NOT c.is_recruiter AND NOT COALESCE(c.is_foreign, FALSE) AND c.enrich_tries < 3
                 AND (c.website IS NULL OR c.lat IS NULL
                      OR NOT EXISTS (SELECT 1 FROM contacts k WHERE k.company_id = c.id))
               ORDER BY c.automatable_value DESC NULLS LAST LIMIT %s""", (args.limit,))
        cols = [d.name for d in cur.description]
        todo = [dict(zip(cols, r)) for r in cur.fetchall()]
        results = Counter()
        for c in todo:
            line = enrich(conn, c)
            results["site"] += "site=-" not in line
            print("  " + line)
    print(f"Enriched {len(todo)} companies ({results['site']} with a website).")


if __name__ == "__main__":
    main()
