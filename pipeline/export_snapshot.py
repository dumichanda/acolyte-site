"""Export dashboard data to web/public/data/snapshot.json.

The public website only reads this file, so visitors never touch the database.
Run after every fetch + classify.
"""
import json
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal

from db import ROOT, connect
from taxonomy import BY_NAME

OUT = ROOT / "web" / "public" / "data" / "snapshot.json"


def rows(conn, sql: str, params=None) -> list[dict]:
    cur = conn.execute(sql, params or {})
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def default(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError(type(o))


def rands(v) -> str:
    v = float(v or 0)
    return f"R{v / 1e6:.1f}m" if v >= 1e6 else f"R{v / 1e3:.0f}k"


def template_commentary(s: dict) -> dict:
    """Plain-language findings computed from the numbers (no AI needed)."""
    k, fam, prov = s["kpis"], s["by_family"], s["by_province"]
    top = fam[0]
    best_score = max(fam, key=lambda f: (f["avg_score"] or 0, f["jobs"]))
    p1 = prov[0]
    # Best place to focus = automatable value weighted by how automatable the role is.
    focus = max(fam, key=lambda f: float(f["value"] or 0) * float(f["avg_score"] or 0))
    share = round(100 * p1["jobs"] / max(k["jobs"], 1))
    return {
        "headline": f"{rands(k['automatable_value'])} a year of automatable work in {k['jobs']} open roles",
        "bullets": [
            f"{top['family']} carries the most automatable value ({rands(top['value'])} across {top['jobs']} roles).",
            f"{best_score['family']} roles are the most automatable, averaging {best_score['avg_score']:.0f}/100.",
            f"{p1['province']} accounts for {share}% of postings; {k['high_share']:.0f}% of all roles score 60+ (high potential).",
            f"{k['jobs_7d']} new roles were posted in the last 7 days.",
        ],
        "recommendation": f"{focus['family']} roles in {p1['province']}: high automation score ({focus['avg_score']:.0f}/100) "
                          f"and {rands(focus['value'])} a year of value. Pitch: {focus['service'][0].lower() + focus['service'][1:]}.",
        "source": "template",
    }


def claude_commentary(s: dict) -> dict:
    import anthropic
    from pydantic import BaseModel

    class Commentary(BaseModel):
        headline: str
        bullets: list[str]
        recommendation: str

    data = {k: s[k] for k in ("kpis", "by_family", "by_province", "trend")}
    client = anthropic.Anthropic()
    resp = client.messages.parse(
        model="claude-opus-5-5",
        max_tokens=4000,
        output_config={"effort": "medium"},
        system=("You are an analyst writing the commentary for Acolyte's South African Automation Opportunity Index. "
                "Write in plain South African business English, rand amounts as R1.2m. One headline (max 14 words), "
                "3-5 bullets of concrete findings with numbers, and one recommendation for where Acolyte should focus. "
                "Only state what the data supports."),
        messages=[{"role": "user", "content": json.dumps(data, default=default)}],
        output_format=Commentary,
    )
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        return template_commentary(s)
    return {**resp.parsed_output.model_dump(), "source": "claude-opus-5-5"}


def commentary(s: dict, use_claude: bool) -> dict:
    if use_claude and os.environ.get("ANTHROPIC_API_KEY"):
        import anthropic
        try:
            return claude_commentary(s)
        except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as e:
            print(f"Claude commentary failed ({e.__class__.__name__}); using template.")
    return template_commentary(s)


def main() -> None:
    with connect() as conn:
        meta = rows(conn, """
            SELECT count(*) AS jobs,
                   bool_or(is_demo) AS has_demo, bool_and(is_demo) AS all_demo,
                   min(posted_at)::date AS from_date, max(posted_at)::date AS to_date,
                   count(*) FILTER (WHERE classify_method = 'claude') AS claude_classified
            FROM v_jobs_value""")[0]

        kpis = rows(conn, """
            SELECT count(*) AS jobs,
                   count(DISTINCT company) AS companies,
                   round(avg(automation_score)) AS avg_score,
                   round(100.0 * count(*) FILTER (WHERE automation_score >= 60) / NULLIF(count(*),0)) AS high_share,
                   sum(automatable_value_zar) AS automatable_value,
                   round(percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_annual)) AS median_salary,
                   count(*) FILTER (WHERE posted_at >= now() - interval '7 days') AS jobs_7d
            FROM v_jobs_value""")[0]

        by_family = rows(conn, """
            SELECT role_family AS family, count(*) AS jobs, round(avg(automation_score)) AS avg_score,
                   sum(automatable_value_zar) AS value, round(avg(salary_annual)) AS avg_salary
            FROM v_jobs_value GROUP BY 1 ORDER BY value DESC""")
        for f in by_family:
            t = BY_NAME.get(f["family"], {})
            f["service"] = t.get("service")
            f["tasks"] = t.get("tasks", [])

        by_province = rows(conn, """
            SELECT COALESCE(province, 'Unknown') AS province, count(*) AS jobs,
                   round(avg(automation_score)) AS avg_score, sum(automatable_value_zar) AS value
            FROM v_jobs_value GROUP BY 1 ORDER BY jobs DESC""")

        # Province x family matrix for the heatmap.
        heatmap = rows(conn, """
            SELECT COALESCE(province, 'Unknown') AS province, role_family AS family,
                   count(*) AS jobs, round(avg(automation_score)) AS avg_score
            FROM v_jobs_value GROUP BY 1, 2""")

        trend = rows(conn, """
            SELECT date_trunc('day', posted_at)::date AS day, count(*) AS jobs,
                   count(*) FILTER (WHERE automation_score >= 60) AS high_jobs,
                   sum(automatable_value_zar) AS value
            FROM v_jobs_value WHERE posted_at >= now() - interval '45 days'
            GROUP BY 1 ORDER BY 1""")

        top_jobs = rows(conn, """
            SELECT title, company, city, province, role_family AS family, automation_score AS score,
                   automatable_value_zar AS value, salary_annual, salary_imputed, url, posted_at::date AS posted,
                   acolyte_service AS service
            FROM v_jobs_value
            -- Strong opportunities first: high automation score, then rand value.
            ORDER BY (automation_score >= 55) DESC, automatable_value_zar DESC NULLS LAST LIMIT 300""")

        top_companies = rows(conn, """
            SELECT company, count(*) AS jobs, round(avg(automation_score)) AS avg_score,
                   sum(automatable_value_zar) AS value,
                   (array_agg(role_family ORDER BY automatable_value_zar DESC))[1] AS main_family
            FROM v_jobs_value WHERE company IS NOT NULL
            GROUP BY 1 HAVING count(*) >= 2 ORDER BY value DESC LIMIT 12""")

        score_dist = rows(conn, """
            SELECT width_bucket(automation_score, 0, 100, 10) AS bucket, count(*) AS jobs
            FROM v_jobs_value GROUP BY 1 ORDER BY 1""")

    snapshot = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "meta": meta,
        "kpis": kpis,
        "by_family": by_family,
        "by_province": by_province,
        "heatmap": heatmap,
        "trend": trend,
        "top_jobs": top_jobs,
        "top_companies": top_companies,
        "score_dist": score_dist,
    }
    snapshot["commentary"] = commentary(snapshot, use_claude="--claude" in sys.argv)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, default=default, indent=1))
    print(f"Wrote {OUT.relative_to(ROOT)} ({meta['jobs']} jobs, demo={meta['has_demo']})")


if __name__ == "__main__":
    main()
