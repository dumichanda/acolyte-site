"""Get the full text of job ads from the employer's own website (Adzuna only gives a short snippet).

    python pipeline/full_descriptions.py            # up to FULLTEXT_PER_RUN jobs (default 20)

Only for employers whose website we know, and only pages on that website (we do not scrape job
boards). A page is accepted when it mentions most words of the job title.
"""
import argparse
import os
import re

from db import connect, init_db
from webtools import domain, fetch, search, strip_tags


def title_words(title: str) -> list[str]:
    return [w for w in re.findall(r"[a-z]{4,}", title.lower()) if w not in {"remote", "hybrid", "contract", "permanent"}]


def find_full_text(title: str, site: str) -> tuple[str, str] | None:
    words = title_words(title)
    if not words:
        return None
    clean_title = re.sub(r"\(.*?\)", "", title).strip()
    for r in search(f'site:{site} "{clean_title}"', n=5):
        if not domain(r["url"]).endswith(site):
            continue
        page = fetch(r["url"])
        if not page:
            continue
        text = strip_tags(page)
        low = text.lower()
        if sum(w in low for w in words) < max(1, round(len(words) * 2 / 3)):
            continue
        # Keep the part of the page from the first mention of the title onwards.
        i = low.find(words[0])
        body = text[max(0, i - 200): i + 8000] if i >= 0 else text[:8000]
        if len(body) > 400:
            return body, r["url"]
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=int(os.environ.get("FULLTEXT_PER_RUN", "20")))
    args = ap.parse_args()
    init_db()
    got = 0
    with connect() as conn:
        todo = conn.execute(
            """SELECT j.id, j.title, c.website FROM v_jobs_value j JOIN companies c ON c.id = j.company_id
               WHERE c.website IS NOT NULL AND NOT c.is_recruiter AND j.full_description_at IS NULL
               ORDER BY j.automatable_value_zar DESC NULLS LAST LIMIT %s""", (args.limit,)).fetchall()
        for jid, title, site in todo:
            res = find_full_text(title, site)
            conn.execute("UPDATE jobs SET full_description = %s, full_description_url = %s, full_description_at = now() "
                         "WHERE id = %s", (res[0] if res else None, res[1] if res else None, jid))
            conn.commit()
            got += bool(res)
            print(f"  {title} @ {site}: {'found' if res else 'not found'}")
    print(f"Full ad text found for {got} of {len(todo)} jobs.")


if __name__ == "__main__":
    main()
