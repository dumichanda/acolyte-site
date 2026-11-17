"""Acolyte's own sales CRM: rank the businesses in our datasets that would buy each industry analyst.

Scores are 0-100 and built from what each analyst can actually show a prospect:
  property     estate agencies   size, spread, price-cut pressure, new stock          (Private Property + Property24)
  retail       retailers         basket coverage, price position vs the market        (Google Shopping SA)
  marketplace  online stores     catalogue overlap, price position, ratings           (Google Shopping SA)
  jobs         employers and     hiring volume, employer rating, recruiters           (job ads + Glassdoor)
               recruiters
Rows live in sales.prospects (private). Rescoring updates score, rank, reasons and metrics but never
touches the stage, notes or contact details the owner added.
"""
from __future__ import annotations

import json
from datetime import date

import psycopg

ANALYSTS = ("property", "retail", "marketplace", "jobs")
SUB_JUNIOR, SUB_SENIOR = 30000, 50000   # monthly plan prices (ZAR), used as the expected deal value

SQL = {
    "property": """
        SELECT agency AS name,
               count(*) FILTER (WHERE active)                                         AS listings,
               count(DISTINCT region) FILTER (WHERE active)                           AS regions,
               count(DISTINCT province) FILTER (WHERE active)                         AS provinces,
               round(100.0 * avg(price_reduced::int) FILTER (WHERE active), 1)        AS cut_pct,
               count(*) FILTER (WHERE first_seen >= current_date - 7)                 AS new_7d,
               round(100.0 * avg((deal_type = 'rent')::int) FILTER (WHERE active), 0) AS rent_pct,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_zar)
                     FILTER (WHERE active AND deal_type = 'sale' AND price_zar > 0))  AS median_sale_zar,
               mode() WITHIN GROUP (ORDER BY region) FILTER (WHERE active)            AS top_region,
               count(DISTINCT portal)                                                 AS portals
        FROM analyst.property_listings
        WHERE agency IS NOT NULL AND agency <> 'Private seller / not stated'
        GROUP BY agency
        HAVING count(*) FILTER (WHERE active) >= 10""",
    "retail": """
        WITH p AS (
          SELECT item, retailer, channel, price_zar,
                 min(price_zar) OVER (PARTITION BY day, item) AS low,
                 avg(price_zar) OVER (PARTITION BY day, item) AS mean,
                 count(*)       OVER (PARTITION BY day, item) AS sellers
          FROM analyst.retail_prices
          WHERE day >= current_date - 14 AND channel <> 'online marketplace')
        SELECT retailer AS name, max(channel) AS channel,
               count(DISTINCT item)                                                   AS items,
               count(*) FILTER (WHERE sellers > 1)                                    AS compared,
               round(100.0 * avg((price_zar <= low)::int) FILTER (WHERE sellers > 1)) AS cheapest_pct,
               round(100.0 * avg(price_zar / NULLIF(mean, 0) - 1) FILTER (WHERE sellers > 1), 1) AS vs_avg_pct
        FROM p WHERE retailer IS NOT NULL
        GROUP BY retailer HAVING count(DISTINCT item) >= 5""",
    "marketplace": """
        SELECT retailer AS name, max(channel) AS channel,
               count(DISTINCT item)                                         AS items,
               count(*)                                                     AS offers,
               round(avg(price_vs_item_median) FILTER (WHERE matches_item), 2) AS vs_median,
               round(avg(rating), 1)                                        AS rating,
               coalesce(sum(reviews), 0)                                    AS reviews
        FROM analyst.retail_offers
        WHERE day >= current_date - 14 AND channel IN ('online marketplace', 'other online store') AND retailer IS NOT NULL
          AND retailer !~* '(desertcart|ubuy|\\.(ae|sa|uk|us|in|ng|ke|au|de|com\\.sa|co\\.uk|com\\.au)$)'   -- SA stores only
        GROUP BY retailer HAVING count(DISTINCT item) >= 3""",
    "jobs": """
        SELECT e.employer AS name, e.is_recruiter, e.province, e.industry, e.size_band, e.open_roles,
               e.main_family, e.website, e.last_posted, r.rating, r.review_count
        FROM analyst.employers e
        LEFT JOIN analyst.employer_ratings r ON r.employer = e.employer
        WHERE NOT e.is_foreign AND e.open_roles >= 2""",
}


def _rank(rows: list[dict], key: str, reverse: bool = False) -> dict[str, float]:
    """Percentile (0-1) of each row on one metric; missing values score 0."""
    vals = sorted((r[key] for r in rows if r.get(key) is not None), reverse=reverse)
    n = len(vals)
    out = {}
    for r in rows:
        v = r.get(key)
        if v is None or n < 2:
            out[r["name"]] = 0.0 if v is None else 0.5
        else:
            below = sum(1 for x in vals if (x > v if reverse else x < v))
            out[r["name"]] = below / (n - 1)
    return out


def _n(v) -> str:
    return f"{int(v):,}".replace(",", " ") if v is not None else "?"


def _r(v) -> str:
    v = float(v or 0)
    return f"R{v / 1e6:.1f}m" if v >= 1e6 else f"R{v / 1e3:.0f}k"


def _score_property(rows):
    big, spread, cuts, new = _rank(rows, "listings"), _rank(rows, "regions"), _rank(rows, "cut_pct"), _rank(rows, "new_7d")
    avg_cut = sum(float(r["cut_pct"] or 0) for r in rows) / max(len(rows), 1)
    out = []
    for r in rows:
        k = r["name"]
        score = 100 * (0.45 * big[k] + 0.2 * spread[k] + 0.2 * cuts[k] + 0.15 * new[k])
        reasons = [f"{_n(r['listings'])} active listings across {r['regions']} regions in {r['provinces']} province(s); busiest in {r['top_region'] or 'n/a'}."]
        cut = float(r["cut_pct"] or 0)
        if cut > avg_cut * 1.2:
            reasons.append(f"{cut:.0f}% of its listings have had a price cut (market average {avg_cut:.0f}%): sellers are overpriced, so CMA pricing and the price-cut watch help it win and keep mandates.")
        if r["new_7d"]:
            reasons.append(f"{_n(r['new_7d'])} new listings in the last 7 days: it is actively winning stock and needs market data for valuations.")
        if (r["rent_pct"] or 0) >= 40:
            reasons.append(f"{r['rent_pct']}% of its stock is rentals: the rental yield screen speaks to its landlord and investor clients.")
        if r["median_sale_zar"]:
            reasons.append(f"Median asking price {_r(r['median_sale_zar'])}.")
        large = (r["listings"] or 0) >= 300 or (r["provinces"] or 0) >= 3
        pitch = ("Agency market share by region, the daily market brief and monthly packs for branch managers."
                 if large else "Comparative market analysis for listing presentations and the price-cut watch to find new mandates.")
        out.append({"name": k, "segment": "Agency network" if large else "Independent agency", "score": score,
                    "reasons": reasons, "pitch": pitch, "value_zar": SUB_SENIOR if large else SUB_JUNIOR, "metrics": r})
    return out


def _score_retail(rows):
    size, comp = _rank(rows, "items"), _rank(rows, "compared")
    gap = _rank([{**r, "gap": abs(float(r["vs_avg_pct"] or 0))} for r in rows], "gap")
    out = []
    for r in rows:
        k = r["name"]
        score = 100 * (0.45 * size[k] + 0.3 * gap[k] + 0.25 * comp[k])
        vs = float(r["vs_avg_pct"] or 0)
        reasons = [f"Priced on {r['items']} of our basket items in the last 2 weeks ({r['channel']})."]
        if r["compared"]:
            reasons.append(f"Cheapest on {r['cheapest_pct'] or 0:.0f}% of items it shares with competitors.")
            reasons.append(f"On average {abs(vs):.1f}% {'above' if vs > 0 else 'below'} the market price for the same items"
                           + (": a clear price-positioning story to tell its category managers." if abs(vs) >= 3 else "."))
        out.append({"name": k, "segment": (r["channel"] or "Retailer").capitalize(), "score": score, "reasons": reasons,
                    "pitch": "Daily competitor price tracking, the basket index and house-brand gap analysis for its buyers.",
                    "value_zar": SUB_SENIOR if (r["items"] or 0) >= 30 else SUB_JUNIOR, "metrics": r})
    return out


def _score_marketplace(rows):
    size, rev = _rank(rows, "items"), _rank(rows, "reviews")
    gap = _rank([{**r, "gap": abs(float(r["vs_median"] or 1) - 1)} for r in rows], "gap")
    out = []
    for r in rows:
        k = r["name"]
        score = 100 * (0.45 * size[k] + 0.3 * gap[k] + 0.25 * rev[k])
        vm = float(r["vs_median"] or 1)
        reasons = [f"Sells {r['items']} of our tracked products online ({_n(r['offers'])} offers in 2 weeks, {r['channel']})."]
        if r["vs_median"]:
            reasons.append(f"Prices average {abs(vm - 1) * 100:.0f}% {'above' if vm > 1 else 'below'} the market median for the same products.")
        if r["rating"]:
            reasons.append(f"Average rating {r['rating']} from {_n(r['reviews'])} reviews.")
        out.append({"name": k, "segment": "Marketplace" if r["channel"] == "online marketplace" else "Online store", "score": score,
                    "reasons": reasons, "pitch": "Price position against Takealot and Amazon.co.za sellers, with rating and review benchmarks.",
                    "value_zar": SUB_JUNIOR, "metrics": r})
    return out


def _score_jobs(rows):
    vol = _rank(rows, "open_roles")
    low = _rank([{**r, "low": (5 - float(r["rating"])) if r.get("rating") else None} for r in rows], "low")
    rated = [float(r["rating"]) for r in rows if r.get("rating")]
    avg = sum(rated) / len(rated) if rated else None
    out = []
    for r in rows:
        k = r["name"]
        recruiter = bool(r["is_recruiter"])
        score = 100 * (0.6 * vol[k] + 0.25 * low[k] + (0.15 if recruiter else 0.05))
        reasons = [f"{_n(r['open_roles'])} open roles advertised" + (f", mostly {r['main_family']}" if r.get("main_family") else "")
                   + (f", in {r['province']}" if r.get("province") else "") + "."]
        if r.get("rating") and avg:
            d = float(r["rating"]) - avg
            reasons.append(f"Glassdoor {float(r['rating']):.1f} vs {avg:.1f} average" +
                           (": a weaker employer brand makes hiring slower, so pay benchmarks and demand data matter." if d < -0.3 else "."))
        if recruiter:
            reasons.append("Recruitment agency: salary benchmarks and hiring-demand data are part of what it sells to clients.")
        out.append({"name": k, "segment": "Recruitment agency" if recruiter else "Employer", "score": score, "reasons": reasons,
                    "pitch": ("Salary benchmarks by role and province, hiring demand trends and employer rating comparisons."
                              if recruiter else "Pay benchmarks for its open roles, competitor hiring and employer-brand comparison."),
                    "value_zar": SUB_SENIOR if recruiter or (r["open_roles"] or 0) >= 20 else SUB_JUNIOR,
                    "website": r.get("website"), "metrics": r})
    return out


SCORERS = {"property": _score_property, "retail": _score_retail, "marketplace": _score_marketplace, "jobs": _score_jobs}


def score(data_db: str, admin_db: str, analyst: str) -> int:
    """Recompute one analyst's prospect list from the data and upsert it. Returns how many were scored."""
    with psycopg.connect(data_db) as conn:
        cur = conn.execute(SQL[analyst])
        cols = [c.name for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    items = sorted(SCORERS[analyst](rows), key=lambda x: -x["score"])
    with psycopg.connect(admin_db) as conn:
        for i, p in enumerate(items, 1):
            conn.execute("""
                INSERT INTO sales.prospects (analyst, name, segment, score, rank, reasons, metrics, pitch, value_zar, website, scored_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (analyst, name) DO UPDATE SET segment = EXCLUDED.segment, score = EXCLUDED.score, rank = EXCLUDED.rank,
                    reasons = EXCLUDED.reasons, metrics = EXCLUDED.metrics, pitch = EXCLUDED.pitch, scored_at = now(),
                    value_zar = COALESCE(sales.prospects.value_zar, EXCLUDED.value_zar),
                    website = COALESCE(sales.prospects.website, EXCLUDED.website)""",
                (analyst, p["name"][:200], p["segment"], round(p["score"], 1), i, json.dumps(p["reasons"]),
                 json.dumps(p["metrics"], default=str), p["pitch"], p["value_zar"], p.get("website")))
        # Businesses that dropped out of the data keep their pipeline history but lose their rank.
        conn.execute("UPDATE sales.prospects SET rank = NULL WHERE analyst = %s AND (scored_at IS NULL OR scored_at < now() - interval '1 minute')",
                     (analyst,))
    return len(items)


FIELDS = ("stage", "pinned", "website", "contact_name", "contact_role", "contact_email", "next_step", "next_date", "value_zar", "notes",
          "agent_id", "consent")


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def board(db: str, analyst: str, limit: int = 100, agent_id: int | None = None) -> dict:
    """The ranked list for one analyst and the pipeline board. An agent sees only their own leads."""
    mine = "AND p.agent_id = %(agent)s" if agent_id else ""
    q = {"analyst": analyst, "limit": limit, "agent": agent_id}
    sel = "SELECT p.*, a.name AS agent_name FROM sales.prospects p LEFT JOIN sales.agents a ON a.id = p.agent_id"
    with psycopg.connect(db) as conn:
        ranked = _rows(conn, f"""{sel} WHERE p.analyst = %(analyst)s AND (p.rank IS NOT NULL OR p.pinned) {mine}
                                ORDER BY p.pinned DESC, p.rank NULLS LAST LIMIT %(limit)s""", q)
        pinned = _rows(conn, f"{sel} WHERE p.pinned {mine} ORDER BY p.updated_at DESC", q)
        totals = _rows(conn, f"""SELECT stage, count(*) AS n, coalesce(sum(value_zar), 0) AS value_zar FROM sales.prospects p
                                WHERE pinned {mine} GROUP BY stage""", q)
        counts = _rows(conn, f"""SELECT analyst, count(*) AS n, max(scored_at) AS scored_at FROM sales.prospects p
                                WHERE (rank IS NOT NULL {'OR pinned' if agent_id else ''}) {mine} GROUP BY analyst""", q)
    return json.loads(json.dumps({"ranked": ranked, "board": pinned, "totals": totals, "counts": counts}, default=str))


def update(db: str, pid: int, patch: dict) -> dict:
    sets = {k: v for k, v in patch.items() if k in FIELDS and v is not None}
    if patch.get("unassign"):
        sets["agent_id"] = None
    if "agent_id" in sets:
        sets["assigned_at"] = "now()"
    if sets.get("consent") in ("granted", "declined", "opted_out"):
        sets["consent_at"] = "now()"
    if not sets:
        raise ValueError("Nothing to change.")
    with psycopg.connect(db) as conn:
        old = conn.execute("SELECT stage, name FROM sales.prospects WHERE id = %s", (pid,)).fetchone()
        if not old:
            raise LookupError("Prospect not found.")
        if sets.get("stage") and sets["stage"] != "prospect":
            sets["pinned"] = True
        raw = {k for k, v in sets.items() if v == "now()"}
        cols = ", ".join(f"{k} = now()" if k in raw else f"{k} = %s" for k in sets)
        conn.execute(f"UPDATE sales.prospects SET {cols}, updated_at = now() WHERE id = %s",
                     (*[v for k, v in sets.items() if k not in raw], pid))
        if "consent" in sets:
            conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, 'stage', %s)",
                         (pid, f"Consent: {sets['consent'].replace('_', ' ')}"))
            if sets["consent"] in ("declined", "opted_out"):
                conn.execute("UPDATE sales.outbox SET status = 'skipped', error = 'declined' WHERE prospect_id = %s AND status IN ('draft', 'approved')", (pid,))
                conn.execute("UPDATE sales.prospects SET stage = 'lost' WHERE id = %s", (pid,))
        if "agent_id" in sets:
            who = conn.execute("SELECT name FROM sales.agents WHERE id = %s", (sets["agent_id"],)).fetchone() if sets["agent_id"] else None
            conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, 'stage', %s)",
                         (pid, f"Assigned to {who[0]}" if who else "Unassigned"))
        if "stage" in sets and sets["stage"] != old[0]:
            conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, 'stage', %s)",
                         (pid, f"Moved from {old[0]} to {sets['stage']}"))
        if sets.get("pinned") is True and "stage" not in sets:
            conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, 'stage', 'Added to the board')", (pid,))
        return json.loads(json.dumps(_rows(conn, "SELECT * FROM sales.prospects WHERE id = %s", (pid,))[0], default=str))


def activities(db: str, pid: int) -> list[dict]:
    with psycopg.connect(db) as conn:
        return json.loads(json.dumps(_rows(conn, "SELECT id, at, kind, text FROM sales.activities WHERE prospect_id = %s ORDER BY at DESC LIMIT 100",
                                           (pid,)), default=str))


def add_activity(db: str, pid: int, kind: str, text: str) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, %s, %s)", (pid, kind, text[:5000]))
        conn.execute("UPDATE sales.prospects SET updated_at = now() WHERE id = %s", (pid,))


def get(db: str, pid: int) -> dict | None:
    with psycopg.connect(db) as conn:
        r = _rows(conn, """SELECT p.*, a.name AS agent_name FROM sales.prospects p LEFT JOIN sales.agents a ON a.id = p.agent_id
                           WHERE p.id = %s""", (pid,))
        if not r:
            return None
        p = r[0]
        sup = conn.execute("""SELECT 1 FROM sales.suppression WHERE lower(value) IN (lower(%s), lower(%s), lower(%s))""",
                           (p["name"], p.get("contact_email") or "", (p.get("contact_email") or "").split("@")[-1])).fetchone()
    p["suppressed"] = bool(sup)
    return json.loads(json.dumps(p, default=str))


def suppress(db: str, value: str, reason: str) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("INSERT INTO sales.suppression (value, reason) VALUES (%s, %s) ON CONFLICT (value) DO NOTHING", (value.strip(), reason))


ANALYST_NAME = {"property": "Property Analyst", "retail": "Retail Pricing Analyst", "marketplace": "Marketplace Analyst", "jobs": "Talent Analyst"}


def draft_prompt(p: dict) -> str:
    who = f"{p['contact_name']} ({p.get('contact_role') or 'decision maker'})" if p.get("contact_name") else "the decision maker (no name yet)"
    return f"""Write a short first email (max 140 words) from Acolyte, a South African AI analytics company, to {who} at {p['name']}
({p.get('segment') or 'business'}). We sell the Acolyte {ANALYST_NAME[p['analyst']]}: an AI analyst on live South African market data
with daily briefs, dashboards and monthly report packs. Use 1-2 of these facts about them from our data, exactly as given:
{chr(10).join('- ' + x for x in (p.get('reasons') or []))}
Lead with: {p.get('pitch')}
Rules: plain, specific, no hype, no made-up numbers or claims, one clear ask (a 20-minute demo on their own market), and a one-line
opt-out at the end ("Reply 'no thanks' and we won't contact you again."). South African English. Give a subject line first as "Subject: ...".
"""


# ---------------------------------------------------------------- agents, outbox
def agents(db: str) -> list[dict]:
    with psycopg.connect(db) as conn:
        return json.loads(json.dumps(_rows(conn, """
            SELECT a.id, a.name, a.email, a.analysts, a.max_open, a.active, a.last_login, a.created_at,
                   count(p.*) FILTER (WHERE p.stage NOT IN ('won', 'lost')) AS open_leads,
                   count(p.*) FILTER (WHERE p.stage = 'won') AS won, coalesce(sum(p.value_zar) FILTER (WHERE p.stage = 'won'), 0) AS won_zar
            FROM sales.agents a LEFT JOIN sales.prospects p ON p.agent_id = a.id
            GROUP BY a.id ORDER BY a.active DESC, a.name"""), default=str))


def save_agent(db: str, data: dict, pin_hash: tuple[str, str] | None, aid: int | None = None) -> int:
    cols = {k: data[k] for k in ("name", "email", "analysts", "max_open", "active") if k in data and data[k] is not None}
    if pin_hash:
        cols["pin_salt"], cols["pin_hash"] = pin_hash   # hash_pin returns (salt, hash)
    with psycopg.connect(db) as conn:
        if aid:
            if cols:
                conn.execute(f"UPDATE sales.agents SET {', '.join(f'{k} = %s' for k in cols)} WHERE id = %s", (*cols.values(), aid))
            return aid
        return conn.execute(f"INSERT INTO sales.agents ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                            tuple(cols.values())).fetchone()[0]


def agent_pins(db: str) -> list[tuple]:
    with psycopg.connect(db) as conn:
        return conn.execute("SELECT id, name, pin_hash, pin_salt FROM sales.agents WHERE active AND pin_hash IS NOT NULL").fetchall()


def agent_seen(db: str, aid: int) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("UPDATE sales.agents SET last_login = now() WHERE id = %s", (aid,))


def get_agent(db: str, aid: int) -> dict | None:
    with psycopg.connect(db) as conn:
        r = _rows(conn, "SELECT id, name, email, analysts, active FROM sales.agents WHERE id = %s AND active", (aid,))
    return r[0] if r else None


def owner_of(db: str, pid: int) -> int | None:
    with psycopg.connect(db) as conn:
        r = conn.execute("SELECT agent_id FROM sales.prospects WHERE id = %s", (pid,)).fetchone()
    if not r:
        raise LookupError("Prospect not found.")
    return r[0]


def outbox(db: str, agent_id: int | None = None, status: str | None = None) -> list[dict]:
    where, q = ["TRUE"], {}
    if agent_id:
        where.append("o.agent_id = %(agent)s"); q["agent"] = agent_id
    if status:
        where.append("o.status = %(status)s"); q["status"] = status
    else:
        where.append("(o.status IN ('draft', 'approved', 'failed') OR o.sent_at > now() - interval '14 days')")
    with psycopg.connect(db) as conn:
        return json.loads(json.dumps(_rows(conn, f"""
            SELECT o.*, p.name AS prospect, p.analyst, p.contact_name, p.consent, a.name AS agent_name
            FROM sales.outbox o JOIN sales.prospects p ON p.id = o.prospect_id LEFT JOIN sales.agents a ON a.id = o.agent_id
            WHERE {' AND '.join(where)} ORDER BY (o.status = 'draft') DESC, o.due_at LIMIT 200""", q), default=str))


def outbox_item(db: str, oid: int) -> dict:
    with psycopg.connect(db) as conn:
        r = _rows(conn, "SELECT * FROM sales.outbox WHERE id = %s", (oid,))
    if not r:
        raise LookupError("Email not found.")
    return r[0]


def outbox_update(db: str, oid: int, action: str, subject: str | None = None, body: str | None = None) -> None:
    from .funnel import mark_sent
    with psycopg.connect(db) as conn:
        o = _rows(conn, "SELECT * FROM sales.outbox WHERE id = %s", (oid,))
        if not o:
            raise LookupError("Email not found.")
        o = o[0]
        if action == "edit":
            if o["status"] not in ("draft", "approved", "failed"):
                raise ValueError("Only unsent emails can be edited.")
            conn.execute("UPDATE sales.outbox SET subject = COALESCE(%s, subject), body = COALESCE(%s, body) WHERE id = %s", (subject, body, oid))
        elif action == "approve":
            if o["status"] not in ("draft", "failed"):
                raise ValueError("This email is not waiting for approval.")
            conn.execute("UPDATE sales.outbox SET status = 'approved', error = NULL, due_at = GREATEST(due_at, now()) WHERE id = %s", (oid,))
            conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, 'email', %s)", (o["prospect_id"], f"Approved: {o['subject']}"))
        elif action == "skip":
            conn.execute("UPDATE sales.outbox SET status = 'skipped' WHERE id = %s AND status IN ('draft', 'approved', 'failed')", (oid,))
        elif action == "sent_manually":
            if o["status"] not in ("draft", "approved", "failed"):
                raise ValueError("This email was already handled.")
            mark_sent(conn, o, "manual")
        else:
            raise ValueError("Unknown action.")


# ---------------------------------------------------------------- website enquiries
ANALYSTS = ("property", "retail", "marketplace", "jobs")


def add_enquiry(db: str, e: dict) -> int:
    """Store a Contact sales form submission. An enquiry about one analyst also becomes a pinned prospect
    (a warm lead, top of the board) with the person as contact; a tick in the marketing box records consent."""
    with psycopg.connect(db) as conn:
        pid = None
        if e["analyst"] in ANALYSTS and e["nature"] == "sales":
            contact = f"{e['first_name']} {e['last_name']}".strip()
            note = f"Website enquiry {date.today():%d %b %Y}: {e.get('message') or '(no message)'}"
            row = conn.execute(
                """INSERT INTO sales.prospects (analyst, name, segment, pinned, stage, contact_name, contact_role, contact_email,
                                                notes, consent, consent_at, score)
                   VALUES (%s, %s, %s, TRUE, 'prospect', %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END, 100)
                   ON CONFLICT (analyst, name) DO UPDATE SET pinned = TRUE, contact_name = EXCLUDED.contact_name,
                       contact_role = EXCLUDED.contact_role, contact_email = EXCLUDED.contact_email,
                       notes = concat_ws(E'\n\n', sales.prospects.notes, EXCLUDED.notes),
                       consent = CASE WHEN %s THEN 'granted' ELSE sales.prospects.consent END,
                       consent_at = CASE WHEN %s THEN now() ELSE sales.prospects.consent_at END, updated_at = now()
                   RETURNING id""",
                (e["analyst"], e["company"], e["company_type"], contact, e["job_role"], e["email"], note,
                 "granted" if e["marketing"] else "unknown", e["marketing"], e["marketing"], e["marketing"])).fetchone()
            pid = row[0]
            conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, 'enquiry', %s)",
                         (pid, f"Website enquiry from {contact} ({e['job_role']}): {(e.get('message') or '')[:500]}"))
        eid = conn.execute(
            """INSERT INTO sales.enquiries (first_name, last_name, email, phone, job_role, company, company_type, industry,
                                            province, postal_code, analyst, nature, message, marketing, prospect_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (e["first_name"], e["last_name"], e["email"], e["phone"], e["job_role"], e["company"], e["company_type"],
             e["industry"], e["province"], e.get("postal_code"), e["analyst"], e["nature"], e.get("message"), e["marketing"], pid)).fetchone()[0]
        # The owner's alert becomes a GitHub issue, so it carries no personal details: those stay in the CRM.
        conn.execute("INSERT INTO admin.alerts (kind, ref, message) VALUES ('enquiry', %s, %s)",
                     (f"E{eid}", f"{e['company']} ({e['company_type']}, {e['industry']}, {e['province']}); "
                                 f"{e['job_role']}; about: {e['analyst']}; nature: {e['nature']}. Details in the CRM."))
        return eid


def enquiries(db: str, limit: int = 50) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _rows(conn, "SELECT * FROM sales.enquiries ORDER BY at DESC LIMIT %s", (limit,))
