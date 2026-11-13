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


def employers_and_tools(conn, kpis: dict) -> dict:
    """Employer explorer, tools & skills in demand, and daily history. Public data only: no contacts."""
    employers = rows(conn, """
        SELECT l.id, l.name, l.website, l.industry, l.size_band, l.linkedin_url, l.description, l.lat, l.lon,
               COALESCE(l.is_foreign, FALSE) AS foreign_firm, l.country,
               COALESCE(l.hq_province, (SELECT province FROM jobs j WHERE j.company_id = l.id AND province IS NOT NULL
                                        GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)) AS province,
               COALESCE(l.hq_city, (SELECT city FROM jobs j WHERE j.company_id = l.id AND city IS NOT NULL
                                    GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)) AS city,
               l.open_roles AS jobs, l.avg_score, l.automatable_value AS value, l.main_family, l.best_pitch AS pitch,
               l.families, l.last_posted::date AS last_posted,
               (SELECT array_agg(t ORDER BY n DESC) FROM (
                    SELECT t, count(*) n FROM jobs j JOIN job_insights i ON i.job_id = j.id, unnest(i.tools) t
                    WHERE j.company_id = l.id GROUP BY t ORDER BY n DESC LIMIT 6) x) AS tools,
               (SELECT json_agg(json_build_object('title', title, 'url', url, 'score', automation_score) ORDER BY automatable_value_zar DESC)
                  FROM (SELECT title, url, automation_score, automatable_value_zar FROM v_jobs_value v
                        WHERE v.company_id = l.id ORDER BY automatable_value_zar DESC LIMIT 5) y) AS roles
        FROM v_company_leads l WHERE NOT l.is_recruiter
        ORDER BY l.automatable_value DESC NULLS LAST LIMIT 400""")
    for e in employers:
        e.pop("id", None)

    posters = rows(conn, """
        SELECT CASE WHEN c.id IS NULL THEN 'Employer not named'
                    WHEN c.is_recruiter THEN 'Recruitment agency' ELSE 'Direct employer' END AS kind,
               count(*) AS jobs
        FROM v_jobs_value v LEFT JOIN companies c ON c.id = v.company_id GROUP BY 1 ORDER BY 2 DESC""")

    def counted(col: str, limit: int = 25) -> list[dict]:
        return rows(conn, f"""
            SELECT t AS name, count(*) AS jobs, round(avg(v.automation_score)) AS avg_score
            FROM v_jobs_value v JOIN job_insights i ON i.job_id = v.id, unnest(i.{col}) t
            GROUP BY 1 ORDER BY 2 DESC LIMIT {limit}""")

    covered = rows(conn, "SELECT count(*) AS n, count(*) FILTER (WHERE i.text_source = 'full') AS full_text "
                         "FROM v_jobs_value v JOIN job_insights i ON i.job_id = v.id")[0]
    tools = {
        "jobs_analysed": covered["n"], "full_text": covered["full_text"],
        "tools": counted("tools"), "skills": counted("skills"), "qualifications": counted("qualifications", 10),
        "languages": counted("languages", 8),
        "tool_by_family": rows(conn, """
            SELECT v.role_family AS family, t AS tool, count(*) AS jobs
            FROM v_jobs_value v JOIN job_insights i ON i.job_id = v.id, unnest(i.tools) t GROUP BY 1, 2"""),
        "work_mode": rows(conn, """SELECT i.work_mode AS name, count(*) AS jobs FROM v_jobs_value v
                                   JOIN job_insights i ON i.job_id = v.id GROUP BY 1 ORDER BY 2 DESC"""),
        "seniority": rows(conn, """SELECT i.seniority AS name, count(*) AS jobs FROM v_jobs_value v
                                   JOIN job_insights i ON i.job_id = v.id GROUP BY 1 ORDER BY 2 DESC"""),
        "experience": rows(conn, """SELECT v.role_family AS family, round(avg(i.experience_years), 1) AS avg_years,
                                           count(i.experience_years) AS jobs
                                    FROM v_jobs_value v JOIN job_insights i ON i.job_id = v.id
                                    WHERE i.experience_years IS NOT NULL GROUP BY 1 ORDER BY 2 DESC"""),
    }

    # Daily history row (one per day, overwritten by later runs the same day).
    by_family = rows(conn, "SELECT role_family AS family, count(*) AS jobs FROM v_jobs_value GROUP BY 1")
    conn.execute(
        """INSERT INTO daily_stats (day, jobs, employers, recruiter_jobs, avg_score, automatable_value, top_tools, by_family)
           VALUES (current_date, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (day) DO UPDATE SET jobs = EXCLUDED.jobs, employers = EXCLUDED.employers,
             recruiter_jobs = EXCLUDED.recruiter_jobs, avg_score = EXCLUDED.avg_score,
             automatable_value = EXCLUDED.automatable_value, top_tools = EXCLUDED.top_tools, by_family = EXCLUDED.by_family""",
        (kpis["jobs"], len(employers), next((p["jobs"] for p in posters if p["kind"] == "Recruitment agency"), 0),
         kpis["avg_score"], kpis["automatable_value"], json.dumps(tools["tools"][:10], default=default),
         json.dumps(by_family, default=default)),
    )
    conn.commit()
    history = rows(conn, """SELECT day, jobs, employers, recruiter_jobs, avg_score, automatable_value
                            FROM daily_stats ORDER BY day DESC LIMIT 120""")[::-1]
    return {"employers": employers, "posters": posters, "insights": tools, "history": history}


def main() -> None:
    with connect() as conn:
        meta = rows(conn, """
            SELECT count(*) AS jobs,
                   bool_or(is_demo) AS has_demo, bool_and(is_demo) AS all_demo,
                   min(posted_at)::date AS from_date, max(posted_at)::date AS to_date,
                   count(*) FILTER (WHERE classify_method = 'claude') AS claude_classified
            FROM v_jobs_value""")[0]
        if not meta["jobs"]:
            # Keep the current snapshot rather than publishing an empty dashboard.
            print("No classified jobs in the last 60 days; snapshot left unchanged.")
            return

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

        extra = employers_and_tools(conn, kpis)

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
        **extra,
    }
    snapshot["commentary"] = commentary(snapshot, use_claude="--claude" in sys.argv)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, default=default, indent=1))
    print(f"Wrote {OUT.relative_to(ROOT)} ({meta['jobs']} jobs, demo={meta['has_demo']})")


if __name__ == "__main__":
    main()
