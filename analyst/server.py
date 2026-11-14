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
import re
import hmac
import json
import os
import threading
from datetime import date, datetime, timezone
import time
import uuid
from collections import defaultdict, deque

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import accounts as acc
from . import clientdata as cd
from .agent import MODEL, TIERS, Budget, Session, answer, query, route
from .industries import BRIEFS, INDUSTRIES

REPORT_RX = re.compile(r"report|pack|deck|presentation|power ?point|\bppt|\bpdf", re.I)

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
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])

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
    industry: str | None = Field(default=None, pattern="^(jobs|property|retail|marketplace)$")


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
                """INSERT INTO admin.analyst_usage (account_id, visitor, session_id, country, question, mode, tier, models, status, error,
                       queries, charts, report, cost_usd, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, duration_ms)
                   VALUES (%(account_id)s, %(visitor)s, %(session_id)s, %(country)s, %(question)s, %(mode)s, %(tier)s, %(models)s, %(status)s,
                       %(error)s, %(queries)s, %(charts)s, %(report)s, %(cost_usd)s, %(input)s, %(cache_read)s, %(cache_write)s,
                       %(output)s, %(duration_ms)s)""", row)
    except Exception as e:  # logging must never break answers
        print(f"usage log failed: {e.__class__.__name__}", flush=True)


def bearer(req: Request) -> str:
    return (req.headers.get("authorization") or "").removeprefix("Bearer ").strip()


def current_account(req: Request) -> dict | None:
    """The signed-in client account, or None for an anonymous demo visitor."""
    aid = acc.read_token(bearer(req)) if bearer(req) else None
    return acc.get_account(ADMIN_DB_URL, aid) if aid else None


def need_account(req: Request) -> dict:
    a = current_account(req)
    if not a:
        raise HTTPException(401, "Please sign in with your PIN.")
    return a


def guard(fn):
    """Turn account-layer refusals into HTTP errors."""
    try:
        return fn()
    except acc.Denied as e:
        raise HTTPException(e.status, str(e))


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "tiers": {t: c["model"] for t, c in TIERS.items()}, "db": bool(DB_URL),
            "ai": bool(os.environ.get("ANTHROPIC_API_KEY")), "budget_left": budget.ok(), "today": budget.stats()}


@app.post("/ask")
def ask(body: Ask, req: Request):
    if not DB_URL or not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "The analyst is not configured yet.")
    account = current_account(req) if bearer(req) else None
    if bearer(req) and not account:
        raise HTTPException(401, "Your sign-in has expired. Please sign in again.")
    if not account and not rate_ok(visitor(req)):
        raise HTTPException(429, f"Limit of {HOURLY} questions an hour reached. Sign in for your plan's allowance.")
    question = body.question.strip()

    # Model tier: signed-in clients get their plan's limits; Junior uses Deep (Opus) for report packs only.
    mode, max_tier = body.mode, "deep"
    if account:
        is_report = bool(REPORT_RX.search(question))
        tier = guard(lambda: acc.allowance(ADMIN_DB_URL, account, route(question, body.mode), is_report))
        plan = acc.PLANS[account["plan"]]
        max_tier = "deep" if is_report else plan["max_tier"]
        mode = tier if (body.mode != "auto" or tier != route(question, "auto")) else "auto"

    # One analyst per subscription: a client account always gets its own analyst; the owner ('all') and demo
    # visitors pick one. Questions never mix datasets.
    industry = (account or {}).get("industry") or "all"
    if industry == "all":
        industry = body.industry or "jobs"

    with lock:
        s = sessions.get(body.session_id or "")
    if s and (s.account_id != (account["id"] if account else None) or s.industry != industry):
        s = None
    if not s and account and body.session_id:  # continue a saved conversation
        saved = acc.get_conversation(ADMIN_DB_URL, account["id"], body.session_id, with_state=True)
        if saved and saved.get("state"):
            st = saved["state"]
            s = Session(id=saved["id"], messages=st.get("messages", []), datasets=st.get("datasets", {}),
                        charts=st.get("charts", {}), account_id=account["id"], ui_items=saved.get("items") or [],
                        ui_artifacts=saved.get("artifacts") or {}, industry=industry)
    if not s:
        s = Session(id=uuid.uuid4().hex, account_id=account["id"] if account else None, industry=industry)
    with lock:
        sessions[s.id] = s
    # The client's own uploaded data: questions then run as the client's private read-only login.
    db_url = DB_URL
    if account:
        try:
            s.client_guide = cd.guide(ADMIN_DB_URL, account["id"])
            if s.client_guide:
                db_url = cd.client_url(DB_URL, account["id"])
        except Exception as e:
            print(f"client data guide failed: {e.__class__.__name__}", flush=True)
    if s.turns >= MAX_TURNS:
        raise HTTPException(429, "This conversation is long. Start a new one to keep going.")

    ip = visitor(req)
    country = req.headers.get("cf-ipcountry") or req.headers.get("x-vercel-ip-country") or None

    def stream():
        t0 = time.time()
        rec = {"queries": [], "charts": 0, "report": False, "status": "done", "error": None, "usage": {}}
        ui = {"kind": "assistant", "text": "", "status": [], "queries": [], "artifacts": [], "done": True}
        yield f"data: {json.dumps({'type': 'session', 'session_id': s.id})}\n\n"
        try:
            for ev in answer(client(), s, question, db_url, budget, mode, max_tier):
                t = ev.get("type")
                if t == "text":
                    ui["text"] += ev["text"]
                elif t == "status":
                    ui["status"].append(ev["text"])
                elif t == "query":
                    d = ev["dataset"]
                    rec["queries"].append({"title": d.get("title"), "sql": d.get("sql"), "rows": d.get("row_count")})
                    ui["queries"].append({**d, "rows": d.get("rows", [])[:100]})
                elif t == "artifact":
                    a = ev["artifact"]
                    rec["charts"] += a.get("kind") == "chart"
                    rec["report"] = rec["report"] or a.get("kind") == "report"
                    ui["artifacts"].append(a["id"])
                    s.ui_artifacts[a["id"]] = a
                elif t == "usage":
                    rec["usage"] = ui["usage"] = ev
                elif t == "error":
                    rec["status"], rec["error"] = "error", ev.get("text")
                    ui["error"] = ev.get("text")
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:  # never leave the browser hanging
            rec["status"], rec["error"] = "error", e.__class__.__name__
            ui["error"] = f"Something went wrong ({e.__class__.__name__})."
            yield f"data: {json.dumps({'type': 'error', 'text': ui['error']})}\n\n"
        finally:
            u = rec["usage"] or {}
            tok = u.get("tokens") or {}
            row = {"account_id": account["id"] if account else None,
                   "visitor": visitor_id(ip), "session_id": s.id, "country": country, "question": question[:1000],
                   "mode": body.mode, "tier": u.get("tier"), "models": u.get("models") or [], "status": rec["status"],
                   "error": (rec["error"] or "")[:500] or None, "queries": json.dumps(rec["queries"])[:20000],
                   "charts": rec["charts"], "report": rec["report"], "cost_usd": u.get("cost_usd"),
                   "input": tok.get("input"), "cache_read": tok.get("cache_read"), "cache_write": tok.get("cache_write"),
                   "output": tok.get("output"), "duration_ms": int((time.time() - t0) * 1000)}
            s.ui_items += [{"kind": "user", "text": question}, ui]

            def persist():
                log_usage(row)
                if account:
                    title = next((i["text"] for i in s.ui_items if i["kind"] == "user"), question)
                    acc.save_conversation(ADMIN_DB_URL, account["id"], s, title, s.ui_items, s.ui_artifacts)
            threading.Thread(target=persist, daemon=True).start()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- client accounts
class Login(BaseModel):
    pin: str = Field(min_length=1, max_length=64)


@app.post("/auth/login")
def auth_login(body: Login, req: Request):
    return guard(lambda: acc.login(ADMIN_DB_URL, body.pin, visitor(req)))


@app.get("/me")
def get_me(account: dict = Depends(need_account)):
    return acc.me(ADMIN_DB_URL, account)


@app.get("/conversations")
def conversations(industry: str | None = None, account: dict = Depends(need_account)):
    own = account.get("industry") or "all"
    ind = own if own != "all" else (industry if industry in INDUSTRIES and industry != "all" else None)
    return {"conversations": acc.list_conversations(ADMIN_DB_URL, account["id"], ind)}


@app.get("/conversations/{cid}")
def conversation(cid: str, account: dict = Depends(need_account)):
    c = acc.get_conversation(ADMIN_DB_URL, account["id"], cid)
    if not c:
        raise HTTPException(404, "Conversation not found.")
    return c


@app.delete("/conversations/{cid}")
def conversation_delete(cid: str, account: dict = Depends(need_account)):
    acc.delete_conversation(ADMIN_DB_URL, account["id"], cid)
    with lock:
        sessions.pop(cid, None)
    return {"ok": True}


class DashIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    delete: bool = False


class TileIn(BaseModel):
    spec: dict


class TilePatch(BaseModel):
    size: str | None = None
    move: str | None = None
    delete: bool = False


@app.get("/dashboards")
def dashboards(account: dict = Depends(need_account)):
    boards = acc.list_dashboards(ADMIN_DB_URL, account["id"])
    from .industries import DASHBOARDS
    if not boards and account.get("industry") in DASHBOARDS:   # first visit: start with the industry's ready-made board
        try:
            acc.create_template_dashboard(ADMIN_DB_URL, account)
            boards = acc.list_dashboards(ADMIN_DB_URL, account["id"])
        except acc.Denied:
            pass
    return {"dashboards": boards, "limit": acc.PLANS[account["plan"]]["dashboards"],
            "templates": [k for k in DASHBOARDS if account.get("industry") in (k, "all")]}


class TemplateIn(BaseModel):
    industry: str | None = Field(default=None, pattern="^(property|retail|marketplace)$")


@app.post("/dashboards/template")
def dashboard_template(body: TemplateIn, account: dict = Depends(need_account)):
    ind = account.get("industry") or "all"
    if body.industry and ind not in (body.industry, "all"):
        raise HTTPException(403, "That dashboard is not part of your workspace.")
    return guard(lambda: acc.create_template_dashboard(ADMIN_DB_URL, account, body.industry or ind))


@app.post("/dashboards")
def dashboard_create(body: DashIn, account: dict = Depends(need_account)):
    return guard(lambda: acc.create_dashboard(ADMIN_DB_URL, account, body.name or "My dashboard"))


@app.patch("/dashboards/{did}")
def dashboard_update(did: int, body: DashIn, account: dict = Depends(need_account)):
    guard(lambda: acc.update_dashboard(ADMIN_DB_URL, account["id"], did, body.name, body.delete))
    return {"ok": True}


@app.post("/dashboards/{did}/tiles")
def tile_add(did: int, body: TileIn, account: dict = Depends(need_account)):
    return guard(lambda: acc.add_tile(ADMIN_DB_URL, account["id"], did, body.spec))


@app.patch("/tiles/{tid}")
def tile_update(tid: int, body: TilePatch, account: dict = Depends(need_account)):
    guard(lambda: acc.update_tile(ADMIN_DB_URL, account["id"], tid, body.size, body.move, body.delete))
    return {"ok": True}


@app.get("/dashboards/{did}/data")
def dashboard_data(did: int, refresh: bool = False, account: dict = Depends(need_account)):
    url = cd.client_url(DB_URL, account["id"]) if cd.has_space(ADMIN_DB_URL, account["id"]) else DB_URL
    return guard(lambda: acc.dashboard_data(ADMIN_DB_URL, url, account["id"], did, refresh, query))


# ---------------------------------------------------------------- the client's own data (CSV / Excel uploads)
@app.get("/data")
def data_list(account: dict = Depends(need_account)):
    return {"tables": cd.list_tables(ADMIN_DB_URL, account["id"]), "limit": cd.TABLE_LIMIT.get(account["plan"], 10),
            "schema": cd.role(account["id"])}


@app.post("/data/upload")
async def data_upload(file: UploadFile = File(...), name: str = Form(default=""), replace: bool = Form(default=False),
                      account: dict = Depends(need_account)):
    body = await file.read(cd.MAX_BYTES + 1)
    import anyio
    return await anyio.to_thread.run_sync(lambda: guard(lambda: cd.upload(ADMIN_DB_URL, account, body, file.filename or "data.csv",
                                                                          name.strip() or None, replace)))


class DescribeIn(BaseModel):
    description: str = Field(max_length=2000)


@app.patch("/data/{tid}")
def data_describe(tid: int, body: DescribeIn, account: dict = Depends(need_account)):
    guard(lambda: cd.describe(ADMIN_DB_URL, account["id"], tid, body.description))
    return {"ok": True}


@app.delete("/data/{tid}")
def data_delete(tid: int, account: dict = Depends(need_account)):
    guard(lambda: cd.delete(ADMIN_DB_URL, account["id"], tid))
    return {"ok": True}


# ---------------------------------------------------------------- daily industry briefs
BRIEF_HOUR = int(os.environ.get("BRIEF_HOUR_SAST", "7"))   # the data refresh finishes around 06:30 SAST
_brief_threads: dict[str, threading.Thread] = {}


def sast_now() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("Africa/Johannesburg"))


def generate_brief(industry: str, day) -> None:
    """Run the industry's brief prompt as a deep report pack and store it. Never raises."""
    t0, report, text, cost, err = time.time(), None, "", 0.0, None
    s = Session(id=f"brief-{industry}-{day}", industry=industry)
    rec_queries = []
    try:
        for ev in answer(client(), s, BRIEFS[industry], DB_URL, Budget(float(os.environ.get("BRIEF_MAX_USD", "3"))), "deep", "deep",
                         max_steps=18):
            t = ev.get("type")
            if t == "text":
                text += ev["text"]
            elif t == "query":
                rec_queries.append({"title": ev["dataset"].get("title"), "sql": ev["dataset"].get("sql")})
            elif t == "artifact" and ev["artifact"].get("kind") == "report":
                report = ev["artifact"]
            elif t == "usage":
                cost = ev.get("cost_usd") or 0.0
            elif t == "error":
                err = ev.get("text")
        if not report and not err:
            err = "The analyst finished without writing a report."
    except Exception as e:
        err = f"{e.__class__.__name__}: {e}"[:300]
    print(f"[brief] {industry} {day}: {'ready' if report else 'failed'} ${cost:.3f} {err or ''}", flush=True)
    try:
        acc.finish_brief(ADMIN_DB_URL, industry, day, report, text, cost, None if report else err)
        log_usage({"account_id": None, "visitor": "daily-brief", "session_id": s.id, "country": None,
                   "question": f"[daily brief] {industry}", "mode": "deep", "tier": "deep", "models": [],
                   "status": "done" if report else "error", "error": err, "queries": json.dumps(rec_queries)[:20000],
                   "charts": len((report or {}).get("charts") or {}), "report": bool(report), "cost_usd": cost,
                   "input": None, "cache_read": None, "cache_write": None, "output": None,
                   "duration_ms": int((time.time() - t0) * 1000)})
    except Exception as e:
        print(f"[brief] could not save: {e}", flush=True)


def start_brief(industry: str, day, force: bool = False) -> bool:
    """Start today's brief in the background unless it is running or done. True if started."""
    if not (DB_URL and os.environ.get("ANTHROPIC_API_KEY")) or industry not in BRIEFS:
        return False
    th = _brief_threads.get(industry)
    if th and th.is_alive():
        return False
    if not acc.claim_brief(ADMIN_DB_URL, industry, day):
        return False
    th = threading.Thread(target=generate_brief, args=(industry, day), daemon=True)
    _brief_threads[industry] = th
    th.start()
    return True


@app.on_event("startup")
def _sync_client_logins() -> None:
    """Client logins' passwords derive from the server secret: re-sync them in case the secret changed."""
    if not ADMIN_DB_URL:
        return
    try:
        import psycopg
        with psycopg.connect(ADMIN_DB_URL, connect_timeout=10) as conn:
            ids = [r[0] for r in conn.execute("SELECT DISTINCT account_id FROM admin.client_tables")]
        for aid in ids:
            cd.ensure_space(ADMIN_DB_URL, aid)
    except Exception as e:
        print(f"client login sync skipped: {e.__class__.__name__}", flush=True)


@app.on_event("startup")
def _reset_interrupted_briefs() -> None:
    """A brief that was 'running' when the server stopped (e.g. a redeploy) can never finish: mark it failed so it
    restarts on the next request instead of waiting for the stale-run timeout."""
    if not ADMIN_DB_URL:
        return
    try:
        import psycopg
        with psycopg.connect(ADMIN_DB_URL, connect_timeout=10) as conn:
            n = conn.execute("""UPDATE admin.briefs SET status = 'failed', error = 'Interrupted by a server restart',
                                started_at = now() - interval '1 hour', finished_at = now() WHERE status = 'running'""").rowcount
        if n:
            print(f"[brief] reset {n} interrupted brief(s)", flush=True)
    except Exception as e:
        print(f"[brief] startup reset skipped: {e.__class__.__name__}", flush=True)


@app.get("/briefs/{industry}")
def brief(industry: str, day: str | None = None, account: dict = Depends(need_account)):
    if industry not in BRIEFS:
        raise HTTPException(404, "No daily brief for that industry.")
    if (account.get("industry") or "all") not in (industry, "all"):
        raise HTTPException(403, "That brief is not part of your workspace.")
    now = sast_now()
    today = now.date()
    status = acc.brief_status(ADMIN_DB_URL, industry, today)
    if status in (None, "failed") and now.hour >= BRIEF_HOUR and not day:
        if start_brief(industry, today):   # first reader of the day after the refresh starts it (takes ~2-3 minutes)
            status = "running"
    b = acc.get_brief(ADMIN_DB_URL, industry, day)
    return {"today": str(today), "today_status": status, "brief": b, "history": acc.list_briefs(ADMIN_DB_URL, industry)}


@app.post("/admin/briefs/{industry}/run")
def brief_run(industry: str, req: Request):
    """Called by the daily workflow after the data refresh (or by hand from the admin page)."""
    require_admin(req)
    if industry not in BRIEFS:
        raise HTTPException(404, "No daily brief for that industry.")
    started = start_brief(industry, sast_now().date())
    return {"started": started, "status": acc.brief_status(ADMIN_DB_URL, industry, sast_now().date())}


@app.get("/admin/briefs/{industry}")
def brief_admin(industry: str, req: Request):
    """Latest brief for an industry (admin token): used by the brief workflow and the admin page."""
    require_admin(req)
    if industry not in BRIEFS:
        raise HTTPException(404, "No daily brief for that industry.")
    today = sast_now().date()
    return {"today": str(today), "today_status": acc.brief_status(ADMIN_DB_URL, industry, today),
            "brief": acc.get_brief(ADMIN_DB_URL, industry, str(today))}


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


class AccountIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    plan: str | None = None
    pin: str | None = Field(default=None, max_length=64)
    active: bool | None = None
    reset_pin: bool = False
    industry: str | None = Field(default=None, pattern="^(all|jobs|property|retail|marketplace)$")


@app.get("/admin/accounts")
def admin_accounts(req: Request):
    require_admin(req)
    return {"accounts": acc.admin_accounts(ADMIN_DB_URL), "plans": acc.PLANS,
            "industries": {k: v["label"] for k, v in INDUSTRIES.items()}}


@app.post("/admin/accounts")
def admin_account_create(body: AccountIn, req: Request):
    require_admin(req)
    return guard(lambda: acc.admin_create_account(ADMIN_DB_URL, body.name or "Client", body.plan or "junior", body.pin,
                                                    body.industry or "all"))


@app.patch("/admin/accounts/{aid}")
def admin_account_update(aid: int, body: AccountIn, req: Request):
    require_admin(req)
    return guard(lambda: acc.admin_update_account(ADMIN_DB_URL, aid, body.plan, body.active, body.reset_pin,
                                                    body.industry))
