"""Turn the employer names in job ads into one clean company record each, and open CRM opportunities.

    python pipeline/companies.py

1. Normalises names ("Clicks Group Limited", "Clicks Group Ltd" -> one company).
2. Flags recruitment agencies: they advertise for other employers, so they are not sales leads.
3. Loads hand/AI research from data/company_research.csv (website, industry, size, LinkedIn page…).
4. Links every job to its company and opens one 'new' opportunity per hiring employer.
"""
import csv
import re

from db import ROOT, connect, init_db

RESEARCH = ROOT / "data" / "company_research.csv"

SUFFIXES = r"\b(pty|proprietary|ltd|limited|llc|inc|incorporated|cc|soc|npc|plc|group careers|careers|t/?a|the)\b"
RECRUITER_WORDS = re.compile(
    r"recruit|personnel|placement|staffing|talent|headhunt|employment (professionals|channel)|human capital|"
    r"resourc(e|ing) (management|solutions)|\bhire\b|hire resolve|hello hired|job ?board|careers24|pnet|"
    r"\bjobs\b|executive search|search (partners|consult)",
    re.I,
)
# Names that hide the employer altogether.
ANONYMOUS = {"", "confidential", "anonymous", "private advertiser", "overseas", "undisclosed", "company confidential"}


def norm_key(name: str) -> str:
    n = (name or "").lower().replace("&", " and ")
    n = re.sub(r"\(.*?\)", " ", n)
    n = re.sub(r"[^a-z0-9 ]+", " ", n)
    n = re.sub(SUFFIXES, " ", n)
    return re.sub(r"\s+", " ", n).strip()


def display_name(name: str) -> str:
    n = re.sub(r"\s+", " ", (name or "")).strip(" .")
    n = re.sub(r"\s*\b(\(Pty\)|Pty|Ltd|Limited|LLC|Llc)\.?(\s+(Ltd|Limited)\.?)*$", "", n, flags=re.I).strip(" .")
    return n or name


def load_research() -> dict[str, dict]:
    """Research rows keyed by the normalised advertised name (and the clean name)."""
    if not RESEARCH.exists():
        return {}
    out = {}
    with RESEARCH.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            r = {k: (v or "").strip() for k, v in r.items()}
            r["is_recruiter"] = r.get("is_recruiter", "").lower() in ("true", "1", "yes")
            for nm in (r.get("name_as_advertised"), r.get("name_clean")):
                if nm:
                    out[norm_key(nm)] = r
    return out


def main() -> None:
    init_db()
    research = load_research()
    with connect() as conn:
        names = conn.execute("SELECT DISTINCT company FROM jobs WHERE NOT is_demo AND company IS NOT NULL").fetchall()
        created = 0
        for (raw,) in names:
            key = norm_key(raw)
            if key in ANONYMOUS:
                continue
            r = research.get(key)
            target_key = norm_key(r["name_clean"]) if r and r.get("name_clean") else key
            row = conn.execute("SELECT id FROM companies WHERE norm_key = %s", (target_key,)).fetchone()
            if not row:
                name = (r or {}).get("name_clean") or display_name(raw)
                row = conn.execute(
                    "INSERT INTO companies (name, norm_key, is_recruiter, source) VALUES (%s, %s, %s, 'jobs') RETURNING id",
                    (name, target_key, bool(RECRUITER_WORDS.search(raw))),
                ).fetchone()
                created += 1
            conn.execute(
                "INSERT INTO company_aliases (alias_key, company_id) VALUES (%s, %s) ON CONFLICT (alias_key) DO UPDATE SET company_id = EXCLUDED.company_id",
                (key, row[0]),
            )

        # Research overrides the heuristics (only fills what it knows).
        for key, r in research.items():
            conn.execute(
                """UPDATE companies SET
                       name = COALESCE(NULLIF(%(name_clean)s, ''), name),
                       is_recruiter = %(is_recruiter)s,
                       website = COALESCE(NULLIF(lower(regexp_replace(%(website)s, '^(https?://)?(www\\.)?|/.*$', '', 'g')), ''), website),
                       industry = COALESCE(NULLIF(%(industry)s, ''), industry),
                       size_band = COALESCE(NULLIF(%(size_band)s, ''), size_band),
                       hq_city = COALESCE(NULLIF(%(hq_city)s, ''), hq_city),
                       hq_province = COALESCE(NULLIF(%(hq_province)s, ''), hq_province),
                       linkedin_url = COALESCE(NULLIF(%(linkedin_url)s, ''), linkedin_url),
                       description = COALESCE(NULLIF(%(description)s, ''), description),
                       confidence = COALESCE(NULLIF(%(confidence)s, ''), confidence),
                       country = COALESCE(NULLIF(%(country)s, ''), country),
                       is_foreign = CASE WHEN NULLIF(%(country)s, '') IS NULL THEN is_foreign
                                         ELSE %(country)s <> 'South Africa' END,
                       source = 'research', enriched_at = COALESCE(enriched_at, now())
                   WHERE id = (SELECT company_id FROM company_aliases WHERE alias_key = %(key)s)""",
                {**{k: r.get(k, "") for k in ("name_clean", "website", "industry", "size_band", "hq_city", "hq_province",
                                               "linkedin_url", "description", "confidence", "country")},
                 "is_recruiter": r["is_recruiter"], "key": key},
            )

        # Link jobs to companies via the alias table (normalisation done in Python, so do it per name).
        for (raw,) in names:
            conn.execute(
                "UPDATE jobs SET company_id = (SELECT company_id FROM company_aliases WHERE alias_key = %s) "
                "WHERE company = %s AND NOT is_demo",
                (norm_key(raw), raw),
            )

        # One opportunity per hiring employer with open roles; refresh its value and pitch.
        # Excluded: firms with no South African presence (is_foreign). Multinationals operating in SA are kept.
        opened = conn.execute(
            """INSERT INTO opportunities (company_id, est_value, pitch)
               SELECT id, automatable_value, best_pitch FROM v_company_leads
               WHERE NOT is_recruiter AND NOT COALESCE(is_foreign, FALSE) AND open_roles > 0
               ON CONFLICT (company_id) DO UPDATE SET est_value = EXCLUDED.est_value, pitch = EXCLUDED.pitch
               RETURNING (xmax = 0)"""
        ).fetchall()
        # Untouched opportunities that no longer apply: the company turned out to be a recruiter, or its ads now
        # belong to a renamed/merged company record. Anything with activity is kept for you to close by hand.
        removed = conn.execute(
            """DELETE FROM opportunities o
               WHERE o.stage = 'new'
                 AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.opportunity_id = o.id AND a.kind <> 'email_draft')
                 AND (EXISTS (SELECT 1 FROM companies c WHERE c.id = o.company_id
                              AND (c.is_recruiter OR COALESCE(c.is_foreign, FALSE)))
                      OR NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id = o.company_id))""").rowcount
        if removed:
            print(f"Removed {removed} opportunities for recruiters, foreign firms or merged companies.")
        conn.commit()
        stats = conn.execute(
            "SELECT count(*), count(*) FILTER (WHERE is_recruiter), count(*) FILTER (WHERE website IS NOT NULL) FROM companies"
        ).fetchone()
    print(f"Companies: {stats[0]} ({created} new), recruiters {stats[1]}, with website {stats[2]}; "
          f"opportunities opened {sum(1 for (n,) in opened if n)}, updated {sum(1 for (n,) in opened if not n)}.")


if __name__ == "__main__":
    main()
