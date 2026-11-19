"""Client accounts (PIN login), plan limits, saved conversations and live dashboards for Acolyte Analyst.

Everything here uses the analyst_admin database login. The AI's own queries never run as that login.
Dashboard tiles re-run their saved SQL through the same read-only guard the AI uses.
"""
import base64
import hashlib
import hmac
import json
import re
import os
import secrets
import threading
import time
from datetime import datetime, timezone

import psycopg

from .providers import scrub_obj

USD_TO_ZAR = float(os.environ.get("USD_TO_ZAR", "18"))

# Limits per plan. Budgets are the AI cost (USD at list prices) behind the usage rings.
PLANS = {
    "junior": {"label": "Junior Analyst", "price_zar": 30000, "questions_day": 150, "reports_day": 2, "reports_week": 8,
               "daily_usd": 100 / USD_TO_ZAR, "weekly_usd": 400 / USD_TO_ZAR, "max_tier": "standard", "deep_for_reports": True,
               "dashboards": 3},
    "senior": {"label": "Senior AI & Data Science Analyst", "price_zar": 50000, "questions_day": 400, "reports_day": 6,
               "reports_week": 25, "daily_usd": 250 / USD_TO_ZAR, "weekly_usd": 1000 / USD_TO_ZAR, "max_tier": "deep",
               "deep_for_reports": True, "dashboards": 10},
    "owner": {"label": "Owner", "price_zar": 0, "questions_day": 1000, "reports_day": 50, "reports_week": 200,
              "daily_usd": 25.0, "weekly_usd": 100.0, "max_tier": "deep", "deep_for_reports": True, "dashboards": 50},
}
TIER_ORDER = ["fast", "standard", "deep"]
SESSION_DAYS = 30


class Denied(Exception):
    """A limit or permission problem to show the user (HTTP status, message)."""
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status


def _secret() -> bytes:
    base = os.environ.get("SESSION_SECRET") or (os.environ.get("ADMIN_TOKEN", "") + os.environ.get("ANALYST_DATABASE_URL", ""))
    return hashlib.sha256(("acolyte-session:" + base).encode()).digest()


# ---------------------------------------------------------------- PINs and session tokens
def new_pin() -> str:
    return f"{secrets.randbelow(10 ** 8):08d}"


def hash_pin(pin: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    return salt, hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()


def make_token(account_id: int) -> str:
    exp = int(time.time()) + SESSION_DAYS * 86400
    body = f"{account_id}.{exp}"
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    return body + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")


def read_token(token: str) -> int | None:
    try:
        acc, exp, sig = token.split(".")
        good = base64.urlsafe_b64encode(hmac.new(_secret(), f"{acc}.{exp}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
        if hmac.compare_digest(sig, good) and int(exp) > time.time():
            return int(acc)
    except (ValueError, AttributeError):
        pass
    return None


# ---------------------------------------------------------------- database helpers
def _rows(conn, sql, params=None):
    cur = conn.execute(sql, params or ())
    if cur.description is None:
        return []
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _jsonable(o):
    return json.loads(json.dumps(o, default=str))


_login_hits: dict[str, list[float]] = {}
_lock = threading.Lock()


def login(db: str, pin: str, ip: str) -> dict:
    now = time.time()
    with _lock:
        hits = [t for t in _login_hits.get(ip, []) if t > now - 300]
        if len(hits) >= 8:
            raise Denied(429, "Too many attempts. Please wait a few minutes.")
        _login_hits[ip] = hits + [now]
    pin = (pin or "").strip()
    if not pin:
        raise Denied(401, "Enter your PIN.")
    with psycopg.connect(db) as conn:
        for a in _rows(conn, "SELECT id, name, plan, pin_salt, pin_hash FROM admin.accounts WHERE active"):
            if hmac.compare_digest(hash_pin(pin, a["pin_salt"])[1], a["pin_hash"]):
                conn.execute("UPDATE admin.accounts SET last_login = now() WHERE id = %s", (a["id"],))
                return {"token": make_token(a["id"]), "account": {"id": a["id"], "name": a["name"], "plan": a["plan"]}}
    raise Denied(401, "That PIN isn't right.")


def get_account(db: str, account_id: int) -> dict | None:
    with psycopg.connect(db) as conn:
        r = _rows(conn, "SELECT id, name, plan, industry, active FROM admin.accounts WHERE id = %s", (account_id,))
    return r[0] if r and r[0]["active"] else None


def usage(db: str, account_id: int) -> dict:
    """Usage since the start of today and of this week (Monday), South African time."""
    with psycopg.connect(db) as conn:
        r = _rows(conn, """
            WITH b AS (SELECT date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' AS d,
                              date_trunc('week', now() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg' AS w)
            SELECT coalesce(sum(cost_usd) FILTER (WHERE at >= b.d), 0) AS day_usd,
                   coalesce(sum(cost_usd), 0) AS week_usd,
                   count(*) FILTER (WHERE at >= b.d) AS questions_today,
                   count(*) FILTER (WHERE at >= b.d AND report) AS reports_today,
                   count(*) FILTER (WHERE report) AS reports_week
            FROM admin.analyst_usage, b WHERE account_id = %s AND at >= b.w GROUP BY b.d""", (account_id,))
    u = r[0] if r else {"day_usd": 0, "week_usd": 0, "questions_today": 0, "reports_today": 0, "reports_week": 0}
    return {k: float(v) if k.endswith("usd") else int(v) for k, v in u.items()}


def me(db: str, account: dict) -> dict:
    plan = PLANS[account["plan"]]
    u = usage(db, account["id"])
    left = lambda used, cap: max(0.0, round(100 * (1 - used / cap), 1)) if cap else 100.0  # noqa: E731
    from .industries import INDUSTRIES
    ind = INDUSTRIES.get(account.get("industry") or "all", INDUSTRIES["all"])
    return {"account": {"id": account["id"], "name": account["name"], "plan": account["plan"], "plan_label": plan["label"],
                        "industry": account.get("industry") or "all", "industry_label": ind["label"], "analyst_name": ind["name"]},
            "limits": {k: plan[k] for k in ("questions_day", "reports_day", "reports_week", "dashboards", "max_tier")},
            "usage": u, "day_left_pct": left(u["day_usd"], plan["daily_usd"]), "week_left_pct": left(u["week_usd"], plan["weekly_usd"])}


def allowance(db: str, account: dict, tier: str, is_report: bool) -> str:
    """Check plan limits before answering; returns the tier to use (capped by the plan)."""
    plan, u = PLANS[account["plan"]], usage(db, account["id"])
    if u["questions_today"] >= plan["questions_day"]:
        raise Denied(429, f"You've used today's {plan['questions_day']} questions. Your allowance resets at midnight.")
    if u["day_usd"] >= plan["daily_usd"]:
        raise Denied(429, "You've used today's analyst allowance. It resets at midnight.")
    if u["week_usd"] >= plan["weekly_usd"]:
        raise Denied(429, "You've used this week's analyst allowance. It resets on Monday.")
    if is_report:
        if u["reports_today"] >= plan["reports_day"]:
            raise Denied(429, f"You've made today's {plan['reports_day']} report packs. Ask questions, or make more tomorrow.")
        if u["reports_week"] >= plan["reports_week"]:
            raise Denied(429, f"You've made this week's {plan['reports_week']} report packs. The count resets on Monday.")
        return tier
    cap = plan["max_tier"]
    return tier if TIER_ORDER.index(tier) <= TIER_ORDER.index(cap) else cap


# ---------------------------------------------------------------- conversations
def _block(b) -> dict:
    """An assistant content block as a plain dict the API accepts back."""
    if isinstance(b, dict):
        d = b
    elif hasattr(b, "model_dump"):
        d = b.model_dump(mode="json", exclude_none=True)
    else:
        d = {k: v for k, v in vars(b).items() if v is not None}
    keep = {"text": ("type", "text", "citations"), "tool_use": ("type", "id", "name", "input"),
            "thinking": ("type", "thinking", "signature"), "redacted_thinking": ("type", "data")}.get(d.get("type"))
    return {k: v for k, v in d.items() if k in keep} if keep else d


def dump_state(s) -> dict:
    msgs = []
    for m in s.messages:
        c = m["content"]
        msgs.append({"role": m["role"], "content": c if isinstance(c, str) else [_block(b) if m["role"] == "assistant" else b for b in c]})
    datasets = {k: {**v, "rows": v["rows"][:200]} for k, v in s.datasets.items()}
    charts = {k: {**v, "rows": v["rows"][:200]} for k, v in s.charts.items()}
    return {"messages": msgs, "datasets": datasets, "charts": charts}


def list_conversations(db: str, account_id: int, industry: str | None = None) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, """SELECT id, title, industry, updated_at FROM admin.conversations WHERE account_id = %s
                                        AND (%s::text IS NULL OR industry = %s) ORDER BY updated_at DESC LIMIT 100""",
                               (account_id, industry, industry)))


def get_conversation(db: str, account_id: int, cid: str, with_state=False) -> dict | None:
    with psycopg.connect(db) as conn:
        r = _rows(conn, f"""SELECT id, title, items, artifacts{', state' if with_state else ''}, updated_at
                            FROM admin.conversations WHERE id = %s AND account_id = %s""", (cid, account_id))
    return _jsonable(r[0]) if r else None


def _forget(o, rx):
    """Remove result rows that came from a connected database set to 'don't keep rows'. Keeps the chart and the answer."""
    if isinstance(o, dict):
        if isinstance(o.get("sql"), str) and rx.match(o["sql"]) and "rows" in o:
            return {**{k: _forget(v, rx) for k, v in o.items() if k != "rows"}, "rows": [], "rows_removed": True}
        return {k: _forget(v, rx) for k, v in o.items()}
    if isinstance(o, list):
        return [_forget(v, rx) for v in o]
    return o


def without_rows(s, state: dict, items: list, artifacts: dict) -> tuple[dict, list, dict]:
    """Apply each connection's 'keep query rows' setting before a conversation is saved."""
    no_keep = [str(c["id"]) for c in getattr(s, "connections", []) or [] if not c.get("store_rows", True)]
    if not no_keep:
        return state, items, artifacts
    state = json.loads(json.dumps(state, default=str))   # never touch the live conversation
    rx = re.compile(r"^/\*conn:(" + "|".join(no_keep) + r")\*/")
    gone = {k for k, v in s.datasets.items() if rx.match(v.get("sql") or "")}

    def trim(text: str) -> str:
        for k in gone:
            if text.startswith(f"dataset_id: {k}\n"):
                return "\n".join(text.split("\n")[:3]) + "\n(rows from this database are not kept after the answer)"
        return text
    for m in state.get("messages", []):
        if isinstance(m.get("content"), list):
            for b in m["content"]:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    c = b.get("content")
                    if isinstance(c, str):
                        b["content"] = trim(c)
                    elif isinstance(c, list):
                        for part in c:
                            if isinstance(part, dict) and isinstance(part.get("text"), str):
                                part["text"] = trim(part["text"])
    return _forget(state, rx), _forget(items, rx), _forget(artifacts, rx)


def save_conversation(db: str, account_id: int, s, title: str, items: list, artifacts: dict) -> None:
    try:
        state, items, artifacts = without_rows(s, dump_state(s), items, artifacts)
        with psycopg.connect(db) as conn:
            conn.execute("""INSERT INTO admin.conversations (id, account_id, title, items, artifacts, state, industry)
                            VALUES (%s, %s, %s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items, artifacts = EXCLUDED.artifacts,
                                state = EXCLUDED.state, updated_at = now()
                            WHERE admin.conversations.account_id = EXCLUDED.account_id""",
                         (s.id, account_id, title[:120], json.dumps(items, default=str), json.dumps(artifacts, default=str),
                          json.dumps(state, default=str), getattr(s, "industry", "jobs") or "jobs"))
    except Exception as e:  # saving history must never break an answer
        print(f"conversation save failed: {e.__class__.__name__}: {e}", flush=True)


def delete_conversation(db: str, account_id: int, cid: str) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("DELETE FROM admin.conversations WHERE id = %s AND account_id = %s", (cid, account_id))


# ---------------------------------------------------------------- dashboards
SPEC_KEYS = ("type", "x", "y", "title", "subtitle", "value_format", "sql", "annotations")


def list_dashboards(db: str, account_id: int) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, """SELECT d.id, d.name, d.updated_at, count(t.id) AS tiles FROM admin.dashboards d
                                        LEFT JOIN admin.dashboard_tiles t ON t.dashboard_id = d.id
                                        WHERE d.account_id = %s GROUP BY d.id ORDER BY d.updated_at DESC""", (account_id,)))


def create_dashboard(db: str, account: dict, name: str) -> dict:
    limit = PLANS[account["plan"]]["dashboards"]
    with psycopg.connect(db) as conn:
        n = conn.execute("SELECT count(*) FROM admin.dashboards WHERE account_id = %s", (account["id"],)).fetchone()[0]
        if n >= limit:
            raise Denied(403, f"Your plan includes {limit} dashboards. Remove one or upgrade to add more.")
        r = _rows(conn, "INSERT INTO admin.dashboards (account_id, name) VALUES (%s, %s) RETURNING id, name",
                  (account["id"], (name or "My dashboard").strip()[:80]))
    return r[0]


def create_template_dashboard(db: str, account: dict, industry: str | None = None) -> dict:
    """Create the industry's ready-made dashboard for this account (counts against the plan's dashboard limit)."""
    from .industries import DASHBOARDS
    tpl = DASHBOARDS.get(industry or account.get("industry") or "")
    if not tpl:
        raise Denied(404, "There is no ready-made dashboard for this industry yet.")
    name, tiles = tpl
    d = create_dashboard(db, account, name)
    with psycopg.connect(db) as conn:
        for pos, spec in enumerate(tiles, 1):
            size = "full" if spec["type"] in ("table", "line", "area") else "half"
            conn.execute("INSERT INTO admin.dashboard_tiles (dashboard_id, position, size, spec) VALUES (%s, %s, %s, %s)",
                         (d["id"], pos, size, json.dumps({k: spec.get(k) for k in SPEC_KEYS})))
    return d


def _own_dashboard(conn, account_id: int, did: int) -> None:
    if not conn.execute("SELECT 1 FROM admin.dashboards WHERE id = %s AND account_id = %s", (did, account_id)).fetchone():
        raise Denied(404, "Dashboard not found.")


def update_dashboard(db: str, account_id: int, did: int, name: str | None, delete: bool = False) -> None:
    with psycopg.connect(db) as conn:
        _own_dashboard(conn, account_id, did)
        if delete:
            conn.execute("DELETE FROM admin.dashboards WHERE id = %s", (did,))
        elif name:
            conn.execute("UPDATE admin.dashboards SET name = %s, updated_at = now() WHERE id = %s", (name.strip()[:80], did))


def add_tile(db: str, account_id: int, did: int, spec: dict) -> dict:
    spec = {k: spec.get(k) for k in SPEC_KEYS}
    if not spec.get("sql") or not spec.get("type") or not spec.get("x"):
        raise Denied(400, "That chart can't be pinned (it has no query).")
    with psycopg.connect(db) as conn:
        _own_dashboard(conn, account_id, did)
        pos = conn.execute("SELECT coalesce(max(position), 0) + 1 FROM admin.dashboard_tiles WHERE dashboard_id = %s", (did,)).fetchone()[0]
        size = "full" if spec["type"] in ("table", "line", "area") else "half"
        r = _rows(conn, """INSERT INTO admin.dashboard_tiles (dashboard_id, position, size, spec) VALUES (%s, %s, %s, %s)
                           RETURNING id""", (did, pos, size, json.dumps(spec)))
        conn.execute("UPDATE admin.dashboards SET updated_at = now() WHERE id = %s", (did,))
    return r[0]


def update_tile(db: str, account_id: int, tid: int, size: str | None = None, move: str | None = None, delete: bool = False) -> None:
    with psycopg.connect(db) as conn:
        t = _rows(conn, """SELECT t.id, t.dashboard_id, t.position FROM admin.dashboard_tiles t JOIN admin.dashboards d
                           ON d.id = t.dashboard_id WHERE t.id = %s AND d.account_id = %s""", (tid, account_id))
        if not t:
            raise Denied(404, "Tile not found.")
        t = t[0]
        if delete:
            conn.execute("DELETE FROM admin.dashboard_tiles WHERE id = %s", (tid,))
        if size in ("half", "full"):
            conn.execute("UPDATE admin.dashboard_tiles SET size = %s WHERE id = %s", (size, tid))
        if move in ("up", "down"):
            op, order = ("<", "DESC") if move == "up" else (">", "ASC")
            other = conn.execute(f"""SELECT id, position FROM admin.dashboard_tiles WHERE dashboard_id = %s AND position {op} %s
                                     ORDER BY position {order} LIMIT 1""", (t["dashboard_id"], t["position"])).fetchone()
            if other:
                conn.execute("UPDATE admin.dashboard_tiles SET position = %s WHERE id = %s", (other[1], tid))
                conn.execute("UPDATE admin.dashboard_tiles SET position = %s WHERE id = %s", (t["position"], other[0]))


_cache: dict[str, tuple[float, list, list]] = {}
CACHE_SECONDS = 900


def dashboard_data(db: str, analyst_db: str, account_id: int, did: int, refresh: bool, run_query) -> dict:
    with psycopg.connect(db) as conn:
        d = _rows(conn, "SELECT id, name, updated_at FROM admin.dashboards WHERE id = %s AND account_id = %s", (did, account_id))
        if not d:
            raise Denied(404, "Dashboard not found.")
        tiles = _rows(conn, "SELECT id, position, size, spec FROM admin.dashboard_tiles WHERE dashboard_id = %s ORDER BY position", (did,))
    out = []
    for t in tiles:
        spec = t["spec"]
        hit = _cache.get(spec["sql"])
        try:
            if refresh or not hit or hit[0] < time.time() - CACHE_SECONDS:
                cols, rows = run_query(spec["sql"], analyst_db)
                hit = _cache[spec["sql"]] = (time.time(), cols, rows)
            out.append({"id": t["id"], "size": t["size"], "spec": spec, "columns": hit[1], "rows": hit[2],
                        "as_of": datetime.fromtimestamp(hit[0], timezone.utc).isoformat()})
        except Exception as e:
            out.append({"id": t["id"], "size": t["size"], "spec": spec, "error": f"Query failed: {str(e)[:160]}"})
    return _jsonable({"dashboard": d[0], "tiles": out})


# ---------------------------------------------------------------- admin: manage accounts
def admin_accounts(db: str) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, """
            SELECT a.id, a.name, a.plan, a.industry, a.active, a.created_at, a.last_login, a.retention_days,
                   (SELECT count(*) FROM admin.connections c WHERE c.account_id = a.id) AS databases,
                   a.brand IS NOT NULL AS branded, a.brand->>'accent' AS brand_accent, a.brand->>'dark' AS brand_dark,
                   (SELECT count(*) FROM admin.analyst_usage u WHERE u.account_id = a.id AND u.at >= now() - interval '30 days') AS questions_30d,
                   (SELECT coalesce(sum(cost_usd), 0) FROM admin.analyst_usage u WHERE u.account_id = a.id AND u.at >= now() - interval '30 days') AS cost_30d,
                   (SELECT count(*) FROM admin.analyst_usage u WHERE u.account_id = a.id AND u.report AND u.at >= now() - interval '30 days') AS reports_30d,
                   (SELECT count(*) FROM admin.dashboards d WHERE d.account_id = a.id) AS dashboards
            FROM admin.accounts a ORDER BY a.created_at"""))


def admin_create_account(db: str, name: str, plan: str, pin: str | None, industry: str = "all") -> dict:
    from .industries import INDUSTRIES
    if plan not in PLANS:
        raise Denied(400, "Unknown plan.")
    if industry not in INDUSTRIES:
        raise Denied(400, "Unknown industry.")
    pin = (pin or "").strip() or new_pin()
    if len(pin) < 6:
        raise Denied(400, "Use a PIN of at least 6 characters.")
    salt, h = hash_pin(pin)
    with psycopg.connect(db) as conn:
        for a in _rows(conn, "SELECT pin_salt, pin_hash FROM admin.accounts"):
            if hmac.compare_digest(hash_pin(pin, a["pin_salt"])[1], a["pin_hash"]):
                raise Denied(400, "That PIN is already used by another account. Choose another.")
        r = _rows(conn, "INSERT INTO admin.accounts (name, plan, industry, pin_salt, pin_hash) VALUES (%s, %s, %s, %s, %s) RETURNING id",
                  ((name or "Client").strip()[:80], plan, industry, salt, h))
    return {"id": r[0]["id"], "pin": pin}


def admin_update_account(db: str, aid: int, plan: str | None, active: bool | None, reset_pin: bool,
                         industry: str | None = None, retention_days: int | None = None) -> dict:
    from .industries import INDUSTRIES
    out = {}
    with psycopg.connect(db) as conn:
        if industry in INDUSTRIES:
            conn.execute("UPDATE admin.accounts SET industry = %s WHERE id = %s", (industry, aid))
        if plan in PLANS:
            conn.execute("UPDATE admin.accounts SET plan = %s WHERE id = %s", (plan, aid))
        if active is not None:
            conn.execute("UPDATE admin.accounts SET active = %s WHERE id = %s", (active, aid))
        if retention_days is not None:
            conn.execute("UPDATE admin.accounts SET retention_days = %s WHERE id = %s", (retention_days, aid))
            conn.execute("DELETE FROM admin.conversations WHERE account_id = %s AND updated_at < now() - make_interval(days => %s)",
                         (aid, retention_days))
        if reset_pin:
            pin = new_pin()
            salt, h = hash_pin(pin)
            conn.execute("UPDATE admin.accounts SET pin_salt = %s, pin_hash = %s WHERE id = %s", (salt, h, aid))
            out["pin"] = pin
    return out


# ---------------------------------------------------------------- daily briefs
def get_brief(db: str, industry: str, day=None) -> dict | None:
    """The requested day's brief, else the latest ready one."""
    with psycopg.connect(db) as conn:
        r = _rows(conn, """SELECT industry, day, status, report, summary, cost_usd, error, started_at, finished_at
                           FROM admin.briefs WHERE industry = %s AND (%s::date IS NULL OR day = %s::date)
                           ORDER BY (status = 'ready') DESC, day DESC LIMIT 1""", (industry, day, day))
    return scrub_obj(_jsonable(r[0])) if r else None


def brief_status(db: str, industry: str, day) -> str | None:
    with psycopg.connect(db) as conn:
        r = conn.execute("SELECT status FROM admin.briefs WHERE industry = %s AND day = %s", (industry, day)).fetchone()
    return r[0] if r else None


def list_briefs(db: str, industry: str, limit: int = 14) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, """SELECT day, status, report->>'title' AS title, finished_at FROM admin.briefs
                                       WHERE industry = %s ORDER BY day DESC LIMIT %s""", (industry, limit)))


def claim_brief(db: str, industry: str, day) -> bool:
    """Mark the day's brief as running. False if it is running or ready already (stale/failed runs can be retried)."""
    with psycopg.connect(db) as conn:
        r = conn.execute("""INSERT INTO admin.briefs AS b (industry, day) VALUES (%s, %s)
                            ON CONFLICT (industry, day) DO UPDATE SET status = 'running', started_at = now(), error = NULL
                            WHERE (b.status = 'failed' AND b.started_at < now() - interval '30 minutes')
                               OR (b.status = 'running' AND b.started_at < now() - interval '20 minutes')
                            RETURNING day""", (industry, day)).fetchone()
    return bool(r)


def finish_brief(db: str, industry: str, day, report: dict | None, summary: str, cost: float, error: str | None) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("""UPDATE admin.briefs SET status = %s, report = %s, summary = %s, cost_usd = %s, error = %s,
                        finished_at = now() WHERE industry = %s AND day = %s""",
                     ("ready" if report else "failed", json.dumps(report, default=str) if report else None, (summary or "")[:4000],
                      cost, (error or "")[:500] or None, industry, day))


# ---------------------------------------------------------------- monthly reports (public sample packs)
def claim_report(db: str, industry: str, period, month_to_date: bool, force: bool = False) -> bool:
    """Mark a monthly report as running. False if it is running or ready already (unless force)."""
    with psycopg.connect(db) as conn:
        r = conn.execute("""INSERT INTO admin.reports AS r (industry, period, month_to_date) VALUES (%s, %s, %s)
                            ON CONFLICT (industry, period) DO UPDATE SET status = 'running', started_at = now(), error = NULL,
                                month_to_date = EXCLUDED.month_to_date
                            WHERE %s OR r.status = 'failed'
                               OR (r.status = 'running' AND r.started_at < now() - interval '25 minutes')
                            RETURNING id""", (industry, period, month_to_date, force)).fetchone()
    return bool(r)


def finish_report(db: str, industry: str, period, report: dict | None, summary: str, cost: float, error: str | None) -> None:
    with psycopg.connect(db) as conn:
        # A failed rewrite keeps the last good report (still published) and records the error next to it.
        conn.execute("""UPDATE admin.reports SET
                          status = CASE WHEN %(rep)s::jsonb IS NOT NULL OR report IS NOT NULL THEN 'ready' ELSE 'failed' END,
                          report = COALESCE(%(rep)s::jsonb, report), title = COALESCE(%(title)s, title),
                          summary = CASE WHEN %(rep)s::jsonb IS NOT NULL THEN %(summary)s ELSE summary END,
                          cost_usd = COALESCE(cost_usd, 0) + %(cost)s, error = %(error)s, finished_at = now()
                        WHERE industry = %(ind)s AND period = %(period)s""",
                     {"rep": json.dumps(report, default=str) if report else None, "title": (report or {}).get("title"),
                      "summary": (summary or "")[:4000], "cost": cost or 0, "error": None if report else ((error or "failed")[:500]),
                      "ind": industry, "period": period})


def report_status(db: str, industry: str, period, with_error: bool = False):
    with psycopg.connect(db) as conn:
        r = conn.execute("SELECT status, error FROM admin.reports WHERE industry = %s AND period = %s", (industry, period)).fetchone()
    if with_error:
        return {"status": r[0], "error": r[1]} if r else {"status": None, "error": None}
    return r[0] if r else None


def list_reports(db: str) -> list[dict]:
    """Published, ready reports (metadata only)."""
    with psycopg.connect(db) as conn:
        return scrub_obj(_jsonable(_rows(conn, """
            SELECT id, industry, period, month_to_date, title, finished_at,
                   report->'exec'->>'takeaway' AS takeaway, report->'exec'->'kpis' AS kpis,
                   jsonb_array_length(COALESCE(report->'sections', '[]')) AS sections
            FROM admin.reports WHERE status = 'ready' AND published ORDER BY period DESC, industry""")))


def get_report(db: str, rid: int) -> dict | None:
    with psycopg.connect(db) as conn:
        r = _rows(conn, """SELECT id, industry, period, month_to_date, title, report, finished_at FROM admin.reports
                           WHERE id = %s AND status = 'ready' AND published""", (rid,))
    return scrub_obj(_jsonable(r[0])) if r else None


# ---------------------------------------------------------------- client branding (admin sets, client's exports use)
BRAND_PRESETS = {
    "acolyte": ("C8F135", "0C0C0E"), "ocean": ("38A3FF", "0B1A2B"), "emerald": ("2ECC8F", "0B1F17"),
    "royal": ("8B7CFF", "14112B"), "sunset": ("FF8A3D", "1F120B"), "gold": ("E8C15A", "141414"),
}
_HEX = __import__("re").compile(r"^[0-9A-Fa-f]{6}$")
_IMG = __import__("re").compile(r"^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$")


def clean_brand(b: dict | None) -> dict | None:
    """Validate a brand from the admin page. None clears it (back to Acolyte's own brand)."""
    if not b:
        return None
    accent, dark = str(b.get("accent", "")).lstrip("#"), str(b.get("dark", "")).lstrip("#")
    if not (_HEX.match(accent) and _HEX.match(dark)):
        raise Denied(400, "Pick two colours (accent and dark).")
    out = {"name": str(b.get("name") or "").strip()[:60], "accent": accent.upper(), "dark": dark.upper(),
           "preset": str(b.get("preset") or "custom")[:20], "style": b.get("style") if b.get("style") in ("light", "dark", "alternate") else "alternate"}
    for key, cap, label in (("logo", 400_000, "Logo"), ("cover", 1_500_000, "Cover image")):
        v = b.get(key)
        if v:
            if not isinstance(v, str) or not _IMG.match(v):
                raise Denied(400, f"{label} must be a PNG or JPG image.")
            if len(v) > cap:
                raise Denied(413, f"{label} is too large; use a file under {cap * 3 // 4 // 1000} KB.")
            out[key] = v
            asp = b.get(key + "Aspect")
            out[key + "Aspect"] = float(asp) if isinstance(asp, (int, float)) and 0.05 < asp < 20 else 1.0
    return out


def get_brand(db: str, account_id: int) -> dict | None:
    with psycopg.connect(db) as conn:
        r = conn.execute("SELECT brand, name FROM admin.accounts WHERE id = %s", (account_id,)).fetchone()
    if not r or not r[0]:
        return None
    b = dict(r[0])
    b["name"] = b.get("name") or r[1]
    return b


def set_brand(db: str, account_id: int, brand: dict | None) -> dict | None:
    b = clean_brand(brand)
    with psycopg.connect(db) as conn:
        if not conn.execute("UPDATE admin.accounts SET brand = %s WHERE id = %s",
                            (json.dumps(b) if b else None, account_id)).rowcount:
            raise Denied(404, "Account not found.")
    return b


# ---------------------------------------------------------------- owner alerts and the AI credit tracker
def add_alert(db: str, kind: str, message: str, ref: str | None = None) -> None:
    """Record an operational problem for the owner. The same kind is recorded at most once an hour. Never raises."""
    try:
        with psycopg.connect(db, connect_timeout=10) as conn:
            if conn.execute("SELECT 1 FROM admin.alerts WHERE kind = %s AND NOT resolved AND at > now() - interval '1 hour'",
                            (kind,)).fetchone():
                return
            conn.execute("INSERT INTO admin.alerts (kind, ref, message) VALUES (%s, %s, %s)", (kind, ref, message[:2000]))
    except Exception as e:
        print(f"[alert] could not record {kind}: {e.__class__.__name__}", flush=True)


def credit_status(db: str) -> dict | None:
    """Estimated AI credit left: the last balance the owner entered, minus what the analyst has spent since."""
    with psycopg.connect(db) as conn:
        r = conn.execute("SELECT id, at, balance_usd, step_pct, alerted_pct FROM admin.credit ORDER BY at DESC LIMIT 1").fetchone()
        if not r:
            return None
        spent = conn.execute("SELECT coalesce(sum(cost_usd), 0) FROM admin.analyst_usage WHERE at >= %s", (r[1],)).fetchone()[0]
    bal, spent = float(r[2]), float(spent)
    used_pct = 100.0 * spent / bal if bal else 100.0
    step = max(1, int(r[3]))
    return {"id": r[0], "since": r[1].isoformat(), "balance_usd": bal, "spent_usd": round(spent, 2),
            "left_usd": round(bal - spent, 2), "used_pct": round(used_pct, 1), "step_pct": step,
            "alerted_pct": int(r[4]), "next_alert_pct": min(100, (int(used_pct) // step + 1) * step)}


def set_credit(db: str, balance_usd: float, step_pct: int = 10) -> dict:
    with psycopg.connect(db) as conn:
        conn.execute("INSERT INTO admin.credit (balance_usd, step_pct) VALUES (%s, %s)", (balance_usd, step_pct))
        conn.execute("UPDATE admin.alerts SET resolved = TRUE WHERE kind IN ('ai_credit', 'low_credit') AND NOT resolved")
    return credit_status(db) or {}


def pending_alerts(db: str) -> list[dict]:
    """Alerts not yet sent to the owner, including one each time another step (e.g. 10%) of the top-up is used."""
    try:
        c = credit_status(db)
        if c:
            reached = min(100, int(c["used_pct"]) // c["step_pct"] * c["step_pct"])
            if reached > c["alerted_pct"]:
                with psycopg.connect(db) as conn:
                    conn.execute("UPDATE admin.credit SET alerted_pct = %s WHERE id = %s", (reached, c["id"]))
                    conn.execute("INSERT INTO admin.alerts (kind, message) VALUES ('low_credit', %s)",
                                 (f"{reached}% of the ${c['balance_usd']:.0f} AI credit used: about ${c['left_usd']:.2f} left "
                                  f"(spent ${c['spent_usd']:.2f} since {c['since'][:16]} UTC). "
                                  "When you top up, record the new balance (admin page or the Owner alerts workflow).",))
    except Exception as e:
        print(f"[alert] credit check failed: {e.__class__.__name__}: {e}", flush=True)
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, "SELECT id, at, kind, ref, message FROM admin.alerts WHERE NOT notified ORDER BY at"))


def mark_notified(db: str, ids: list[int]) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("UPDATE admin.alerts SET notified = TRUE WHERE id = ANY(%s)", (ids,))


def recent_alerts(db: str, limit: int = 20) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, "SELECT id, at, kind, ref, message, notified, resolved FROM admin.alerts ORDER BY at DESC LIMIT %s", (limit,)))
