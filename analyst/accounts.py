"""Client accounts (PIN login), plan limits, saved conversations and live dashboards for Acolyte Analyst.

Everything here uses the analyst_admin database login. The AI's own queries never run as that login.
Dashboard tiles re-run their saved SQL through the same read-only guard the AI uses.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime, timezone

import psycopg

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
        r = _rows(conn, "SELECT id, name, plan, active FROM admin.accounts WHERE id = %s", (account_id,))
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
    return {"account": {"id": account["id"], "name": account["name"], "plan": account["plan"], "plan_label": plan["label"]},
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


def list_conversations(db: str, account_id: int) -> list[dict]:
    with psycopg.connect(db) as conn:
        return _jsonable(_rows(conn, """SELECT id, title, updated_at FROM admin.conversations WHERE account_id = %s
                                        ORDER BY updated_at DESC LIMIT 100""", (account_id,)))


def get_conversation(db: str, account_id: int, cid: str, with_state=False) -> dict | None:
    with psycopg.connect(db) as conn:
        r = _rows(conn, f"""SELECT id, title, items, artifacts{', state' if with_state else ''}, updated_at
                            FROM admin.conversations WHERE id = %s AND account_id = %s""", (cid, account_id))
    return _jsonable(r[0]) if r else None


def save_conversation(db: str, account_id: int, s, title: str, items: list, artifacts: dict) -> None:
    try:
        with psycopg.connect(db) as conn:
            conn.execute("""INSERT INTO admin.conversations (id, account_id, title, items, artifacts, state)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items, artifacts = EXCLUDED.artifacts,
                                state = EXCLUDED.state, updated_at = now()
                            WHERE admin.conversations.account_id = EXCLUDED.account_id""",
                         (s.id, account_id, title[:120], json.dumps(items, default=str), json.dumps(artifacts, default=str),
                          json.dumps(dump_state(s), default=str)))
    except Exception as e:  # saving history must never break an answer
        print(f"conversation save failed: {e.__class__.__name__}: {e}", flush=True)


def delete_conversation(db: str, account_id: int, cid: str) -> None:
    with psycopg.connect(db) as conn:
        conn.execute("DELETE FROM admin.conversations WHERE id = %s AND account_id = %s", (cid, account_id))


# ---------------------------------------------------------------- dashboards
SPEC_KEYS = ("type", "x", "y", "title", "subtitle", "value_format", "sql")


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
            SELECT a.id, a.name, a.plan, a.active, a.created_at, a.last_login,
                   (SELECT count(*) FROM admin.analyst_usage u WHERE u.account_id = a.id AND u.at >= now() - interval '30 days') AS questions_30d,
                   (SELECT coalesce(sum(cost_usd), 0) FROM admin.analyst_usage u WHERE u.account_id = a.id AND u.at >= now() - interval '30 days') AS cost_30d,
                   (SELECT count(*) FROM admin.analyst_usage u WHERE u.account_id = a.id AND u.report AND u.at >= now() - interval '30 days') AS reports_30d,
                   (SELECT count(*) FROM admin.dashboards d WHERE d.account_id = a.id) AS dashboards
            FROM admin.accounts a ORDER BY a.created_at"""))


def admin_create_account(db: str, name: str, plan: str, pin: str | None) -> dict:
    if plan not in PLANS:
        raise Denied(400, "Unknown plan.")
    pin = (pin or "").strip() or new_pin()
    if len(pin) < 6:
        raise Denied(400, "Use a PIN of at least 6 characters.")
    salt, h = hash_pin(pin)
    with psycopg.connect(db) as conn:
        for a in _rows(conn, "SELECT pin_salt, pin_hash FROM admin.accounts"):
            if hmac.compare_digest(hash_pin(pin, a["pin_salt"])[1], a["pin_hash"]):
                raise Denied(400, "That PIN is already used by another account. Choose another.")
        r = _rows(conn, "INSERT INTO admin.accounts (name, plan, pin_salt, pin_hash) VALUES (%s, %s, %s, %s) RETURNING id",
                  ((name or "Client").strip()[:80], plan, salt, h))
    return {"id": r[0]["id"], "pin": pin}


def admin_update_account(db: str, aid: int, plan: str | None, active: bool | None, reset_pin: bool) -> dict:
    out = {}
    with psycopg.connect(db) as conn:
        if plan in PLANS:
            conn.execute("UPDATE admin.accounts SET plan = %s WHERE id = %s", (plan, aid))
        if active is not None:
            conn.execute("UPDATE admin.accounts SET active = %s WHERE id = %s", (active, aid))
        if reset_pin:
            pin = new_pin()
            salt, h = hash_pin(pin)
            conn.execute("UPDATE admin.accounts SET pin_salt = %s, pin_hash = %s WHERE id = %s", (salt, h, aid))
            out["pin"] = pin
    return out
