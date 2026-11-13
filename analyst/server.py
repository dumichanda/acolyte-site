"""Acolyte Analyst web service.

    pip install -r analyst/requirements.txt
    ANTHROPIC_API_KEY=... ANALYST_DATABASE_URL=postgresql://analyst_web:...@.../neondb?sslmode=require \\
        uvicorn analyst.server:app --port 8000

Environment
  ANTHROPIC_API_KEY        Claude API key
  ANALYST_DATABASE_URL     read-only login (role analyst_web; see pipeline/db.py)
  ALLOWED_ORIGINS          comma-separated sites allowed to call this API (default: the GitHub Pages site + localhost)
  ANALYST_DAILY_BUDGET_USD daily spend cap for the public demo (default 3)
  ANALYST_HOURLY_LIMIT     questions per visitor per hour (default 20)
  ANALYST_MODEL / ANALYST_EFFORT  default claude-opus-5-5 / medium
"""
import hashlib
import hmac
import json
import os
import threading
from datetime import date, datetime, timezone
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import MODEL, TIERS, Budget, Session, answer

DB_URL = os.environ.get("ANALYST_DATABASE_URL", "")
# Admin login: same host and password, user analyst_admin (created by the pipeline's database setup).
ADMIN_DB_URL = os.environ.get("ADMIN_DATABASE_URL") or DB_URL.replace("//analyst_web:", "//analyst_admin:", 1)
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
SALT = hashlib.sha256(("acolyte-visitors:" + DB_URL).encode()).hexdigest()
ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "https://dumichanda.github.io,http://localhost:5173,http://localhost:4173").split(",") if o.strip()]
HOURLY = int(os.environ.get("ANALYST_HOURLY_LIMIT", "20"))
MAX_TURNS = 25
SESSION_TTL = 2 * 3600

app = FastAPI(title="Acolyte Analyst", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])

budget = Budget(float(os.environ.get("ANALYST_DAILY_BUDGET_USD", "3")))
sessions: dict[str, Session] = {}
hits: dict[str, deque] = defaultdict(deque)
lock = threading.Lock()
_client = None


def client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()
    return _client


class Ask(BaseModel):
    session_id: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=1500)
    mode: str = Field(default="auto", pattern="^(auto|fast|standard|deep)$")


def visitor(req: Request) -> str:
    fwd = req.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (req.client.host if req.client else "?")


def rate_ok(ip: str) -> bool:
    now = time.time()
    with lock:
        q = hits[ip]
        while q and q[0] < now - 3600:
            q.popleft()
        if len(q) >= HOURLY:
            return False
        q.append(now)
        for sid in [k for k, s in sessions.items() if s.updated < now - SESSION_TTL]:
            sessions.pop(sid, None)
    return True


def visitor_id(ip: str) -> str:
    """Daily-salted hash: counts unique visitors per day without storing IP addresses."""
    return hashlib.sha256(f"{date.today()}:{ip}:{SALT}".encode()).hexdigest()[:16]


def log_usage(row: dict) -> None:
    if not ADMIN_DB_URL:
        return
    try:
        import psycopg
        with psycopg.connect(ADMIN_DB_URL, connect_timeout=10) as conn:
            conn.execute(
                """INSERT INTO admin.analyst_usage (visitor, session_id, country, question, mode, tier, models, status, error,
                       queries, charts, report, cost_usd, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, duration_ms)
                   VALUES (%(visitor)s, %(session_id)s, %(country)s, %(question)s, %(mode)s, %(tier)s, %(models)s, %(status)s,
                       %(error)s, %(queries)s, %(charts)s, %(report)s, %(cost_usd)s, %(input)s, %(cache_read)s, %(cache_write)s,
                       %(output)s, %(duration_ms)s)""", row)
    except Exception as e:  # logging must never break answers
        print(f"usage log failed: {e.__class__.__name__}", flush=True)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "tiers": {t: c["model"] for t, c in TIERS.items()}, "db": bool(DB_URL),
            "ai": bool(os.environ.get("ANTHROPIC_API_KEY")), "budget_left": budget.ok(), "today": budget.stats()}


@app.post("/ask")
def ask(body: Ask, req: Request):
    if not DB_URL or not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "The analyst is not configured yet.")
    if not rate_ok(visitor(req)):
        raise HTTPException(429, f"Limit of {HOURLY} questions an hour reached. Please try again later.")
    with lock:
        s = sessions.get(body.session_id or "")
        if not s:
            s = Session(id=uuid.uuid4().hex)
            sessions[s.id] = s
    if s.turns >= MAX_TURNS:
        raise HTTPException(429, "This conversation is long. Start a new one to keep going.")

    ip = visitor(req)
    country = req.headers.get("cf-ipcountry") or req.headers.get("x-vercel-ip-country") or None

    def stream():
        t0 = time.time()
        rec = {"queries": [], "charts": 0, "report": False, "status": "done", "error": None, "usage": {}}
        yield f"data: {json.dumps({'type': 'session', 'session_id': s.id})}\n\n"
        try:
            for ev in answer(client(), s, body.question.strip(), DB_URL, budget, body.mode):
                t = ev.get("type")
                if t == "query":
                    d = ev["dataset"]
                    rec["queries"].append({"title": d.get("title"), "sql": d.get("sql"), "rows": d.get("row_count")})
                elif t == "artifact":
                    rec["charts"] += ev["artifact"].get("kind") == "chart"
                    rec["report"] = rec["report"] or ev["artifact"].get("kind") == "report"
                elif t == "usage":
                    rec["usage"] = ev
                elif t == "error":
                    rec["status"], rec["error"] = "error", ev.get("text")
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:  # never leave the browser hanging
            rec["status"], rec["error"] = "error", e.__class__.__name__
            yield f"data: {json.dumps({'type': 'error', 'text': f'Something went wrong ({e.__class__.__name__}).'})}\n\n"
        finally:
            u = rec["usage"] or {}
            tok = u.get("tokens") or {}
            threading.Thread(target=log_usage, daemon=True, args=({
                "visitor": visitor_id(ip), "session_id": s.id, "country": country, "question": body.question.strip()[:1000],
                "mode": body.mode, "tier": u.get("tier"), "models": u.get("models") or [], "status": rec["status"],
                "error": (rec["error"] or "")[:500] or None, "queries": json.dumps(rec["queries"])[:20000],
                "charts": rec["charts"], "report": rec["report"], "cost_usd": u.get("cost_usd"),
                "input": tok.get("input"), "cache_read": tok.get("cache_read"), "cache_write": tok.get("cache_write"),
                "output": tok.get("output"), "duration_ms": int((time.time() - t0) * 1000)},)).start()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def require_admin(req: Request) -> None:
    token = (req.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    if not ADMIN_TOKEN or not hmac.compare_digest(token, ADMIN_TOKEN):
        raise HTTPException(401, "Admin key required.")


@app.get("/admin/stats")
def admin_stats(req: Request, days: int = 30):
    require_admin(req)
    import psycopg
    days = max(1, min(days, 90))

    def rows(conn, sql, params=None):
        cur = conn.execute(sql, params or ())
        cols = [c.name for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    try:
        with psycopg.connect(ADMIN_DB_URL, connect_timeout=10) as conn:
            windows = {w: rows(conn, """
                SELECT count(*) AS questions, count(DISTINCT visitor) AS visitors, count(DISTINCT session_id) AS sessions,
                       coalesce(sum(cost_usd), 0) AS cost_usd, count(*) FILTER (WHERE status = 'error') AS errors,
                       count(*) FILTER (WHERE report) AS reports, coalesce(sum(charts), 0) AS charts,
                       round(avg(duration_ms)) AS avg_ms, round(avg(cost_usd)::numeric, 5) AS avg_cost,
                       coalesce(sum(jsonb_array_length(queries)), 0) AS sql_queries
                FROM admin.analyst_usage WHERE at >= now() - make_interval(days => %s)""", (w,))[0] for w in (1, 7, days)}
            out = {
                "generated": datetime.now(timezone.utc).isoformat(), "days": days, "live_budget": budget.stats(),
                "windows": {"today": windows[1], "7d": windows[7], "period": windows[days]},
                "daily": rows(conn, """SELECT at::date AS day, coalesce(tier, 'unknown') AS tier, count(*) AS questions,
                                              coalesce(sum(cost_usd), 0) AS cost_usd, count(DISTINCT visitor) AS visitors
                                       FROM admin.analyst_usage WHERE at >= now() - make_interval(days => %s)
                                       GROUP BY 1, 2 ORDER BY 1""", (days,)),
                "by_tier": rows(conn, """SELECT coalesce(tier, 'unknown') AS tier, count(*) AS questions, coalesce(sum(cost_usd), 0) AS cost_usd,
                                                round(avg(cost_usd)::numeric, 5) AS avg_cost, round(avg(duration_ms)) AS avg_ms
                                         FROM admin.analyst_usage WHERE at >= now() - make_interval(days => %s) GROUP BY 1""", (days,)),
                "countries": rows(conn, """SELECT coalesce(country, '?') AS country, count(DISTINCT visitor) AS visitors, count(*) AS questions
                                           FROM admin.analyst_usage WHERE at >= now() - make_interval(days => %s)
                                           GROUP BY 1 ORDER BY 2 DESC LIMIT 10""", (days,)),
                "recent": rows(conn, """SELECT id, at, country, question, mode, tier, models, status, error, queries, charts, report,
                                               cost_usd, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, duration_ms,
                                               left(visitor, 6) AS visitor
                                        FROM admin.analyst_usage ORDER BY id DESC LIMIT 80"""),
                "pipeline": rows(conn, "SELECT * FROM admin.pipeline_totals")[0],
                "adzuna": rows(conn, "SELECT * FROM admin.adzuna_usage WHERE month >= date_trunc('month', now() - interval '2 months') ORDER BY month DESC, source"),
                "agents": rows(conn, "SELECT * FROM admin.agent_costs ORDER BY id DESC LIMIT 30"),
                "agent_spend": rows(conn, """SELECT agent, count(*) AS runs, coalesce(sum(cost_usd), 0) AS cost_usd
                                             FROM admin.agent_costs WHERE started_at >= now() - make_interval(days => %s) GROUP BY 1""", (days,)),
                "crm": rows(conn, "SELECT * FROM admin.crm_totals ORDER BY opportunities DESC"),
            }
    except psycopg.Error as e:
        print(f"admin stats failed: {e}", flush=True)
        raise HTTPException(503, "Admin database unavailable (has the setup run created the analyst_admin login?).")
    return json.loads(json.dumps(out, default=str))
