"""Publish the monthly reports to the static site: web/public/data/reports/index.json + one JSON file per report.

Reports are written by the Analyst server (admin.reports); this copies the published ones next to the site so the
landing page and the Reports page load instantly without waking the API.

    python export_reports.py
"""
import json
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from db import connect

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "reports"
NAMES = {"jobs": "Talent Analyst", "property": "Property Analyst", "retail": "Retail Pricing Analyst",
         "marketplace": "Marketplace Analyst"}


def default(o):
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(type(o))


def main() -> None:
    with connect() as conn:
        try:
            cur = conn.execute("""SELECT id, industry, period, month_to_date, title, report, finished_at FROM admin.reports
                                  WHERE status = 'ready' AND published ORDER BY period DESC, industry""")
        except Exception as e:
            print(f"(no reports yet: {e.__class__.__name__})")
            return
        rows = cur.fetchall()
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for rid, ind, period, mtd, title, rep, fin in rows:
        ex = (rep or {}).get("exec") or {}
        index.append({"id": rid, "industry": ind, "analyst": NAMES.get(ind, ind), "period": period, "month_to_date": mtd,
                      "title": title or (rep or {}).get("title"), "takeaway": ex.get("takeaway") or (rep or {}).get("summary"),
                      "kpis": (ex.get("kpis") or [])[:3], "sections": len((rep or {}).get("sections") or []),
                      "published": fin})
        (OUT / f"{rid}.json").write_text(json.dumps({"id": rid, "industry": ind, "analyst": NAMES.get(ind, ind),
                                                     "period": period, "month_to_date": mtd, "report": rep},
                                                    default=default))
    (OUT / "index.json").write_text(json.dumps({"generated": datetime.now(timezone.utc).isoformat(), "reports": index},
                                               default=default, indent=1))
    print(f"Published {len(index)} report(s) to {OUT.relative_to(ROOT)}.")


if __name__ == "__main__":
    main()
