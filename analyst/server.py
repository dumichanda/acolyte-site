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
from .agent import MODEL, TIERS, Budget, Session, answer, cost_of, query, route
from .industries import BRIEFS, INDUSTRIES, MONTHLY, monthly_prompt

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
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"], allow_headers=["Content-Type", "Authorization"])

budget = Budget(float(os.environ.get("ANALYST_DAILY_BUDGET_USD", "3")))
sessions: dict[str, Session] = {}
hits: dict[str, deque] = defaultdict(deque)
lock = threading.Lock()
_client = None


def client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic(max_retries=5)  # long report runs ride out brief overloads
    return _client


class Ask(BaseModel):
    session_id: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=1500)
    mode: str = Field(default="auto", pattern="^(auto|fast|standard|deep)$")
    industry: str | None = Field(default=None, pattern="^(jobs|property|retail|marketplace)$")
    context: str | None = Field(default=None, max_length=16000)
    style: str = Field(default="balanced", pattern="^(formal|balanced|creative)$")   # the analyst's creative range   # what the user is looking at (a dashboard view)


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
    return {"ok": True, "db": bool(DB_URL),
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
    s.view_context = (body.context or "").strip()
    s.style = body.style
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
                    rec["status"], rec["error"] = "error", ev.get("detail") or ev.get("text")
                    if ev.get("kind"):
                        acc.add_alert(ADMIN_DB_URL, ev["kind"], ev.get("detail") or ev.get("text", ""), ev.get("ref"))
                    if ev.get("detail") and (account or {}).get("plan") == "owner":   # only the owner sees the technical cause
                        ev = {**ev, "text": f"{ev['text']} Detail (owner only): {ev['detail']}"}
                    ev = {k: v for k, v in ev.items() if k not in ("detail", "kind")}
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
            "schema": cd.role(account["id"]), "sheets_email": cd.robot_email()}


class SheetIn(BaseModel):
    url: str = Field(min_length=10, max_length=1000)
    name: str | None = Field(default=None, max_length=80)
    replace: bool = False


@app.post("/data/sheet")
def data_sheet(body: SheetIn, account: dict = Depends(need_account)):
    """Connect a Google Sheet: synced now, then every morning after the data refresh."""
    return guard(lambda: cd.add_sheet(ADMIN_DB_URL, account, body.url, (body.name or "").strip() or None, body.replace))


@app.post("/data/{tid}/sync")
def data_sync(tid: int, account: dict = Depends(need_account)):
    return guard(lambda: cd.sync_table(ADMIN_DB_URL, account, tid))


@app.post("/admin/data/sync")
def data_sync_all(req: Request):
    """Daily: re-sync every connected Google Sheet (called by the refresh workflow)."""
    require_admin(req)
    return cd.sync_all(ADMIN_DB_URL)


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


def write_pack(industry: str, prompt: str, sid: str, label: str) -> tuple[dict | None, str, float, str | None]:
    """Run a prompt as a deep report pack for an industry analyst. Returns (report, text, cost, error). Never raises."""
    t0, report, text, cost, err = time.time(), None, "", 0.0, None
    s = Session(id=sid, industry=industry, web=label == "monthly-report")   # monthly packs research the web; daily briefs do not
    rec_queries = []
    try:
        for ev in answer(client(), s, prompt, DB_URL, Budget(float(os.environ.get("BRIEF_MAX_USD", "3"))), "deep", "deep",
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
                err = ev.get("detail") or ev.get("text")
                if ev.get("kind"):
                    acc.add_alert(ADMIN_DB_URL, ev["kind"], f"[{label} {industry}] {err}", ev.get("ref"))
        if not report and not err:
            err = "The analyst finished without writing a report."
    except Exception as e:
        err = f"{e.__class__.__name__}: {e}"[:300]
    print(f"[{label}] {industry}: {'ready' if report else 'failed'} ${cost:.3f} {err or ''}", flush=True)
    log_usage({"account_id": None, "visitor": label, "session_id": sid, "country": None,
               "question": f"[{label}] {industry}", "mode": "deep", "tier": "deep", "models": [],
               "status": "done" if report else "error", "error": err, "queries": json.dumps(rec_queries)[:20000],
               "charts": len((report or {}).get("charts") or {}), "report": bool(report), "cost_usd": cost,
               "input": None, "cache_read": None, "cache_write": None, "output": None,
               "duration_ms": int((time.time() - t0) * 1000)})
    return report, text, cost, (None if report else err)


def generate_brief(industry: str, day) -> None:
    report, text, cost, err = write_pack(industry, BRIEFS[industry], f"brief-{industry}-{day}", "daily-brief")
    try:
        acc.finish_brief(ADMIN_DB_URL, industry, day, report, text, cost, err)
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
            conn.execute("""UPDATE admin.reports SET status = CASE WHEN report IS NULL THEN 'failed' ELSE 'ready' END,
                            error = 'Interrupted by a server restart',
                            started_at = now() - interval '1 hour', finished_at = now() WHERE status = 'running'""")
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


# ---------------------------------------------------------------- monthly reports
_report_threads: dict[str, threading.Thread] = {}


def _period(month: str | None):
    """'2026-11' -> date(2026, 11, 1); default the current SAST month. Returns (period, month_to_date)."""
    from datetime import date as _d
    today = sast_now().date()
    if month:
        try:
            y, m = (int(x) for x in month.split("-")[:2])
            p = _d(y, m, 1)
        except ValueError:
            raise HTTPException(400, "Use month=YYYY-MM.")
    else:
        p = _d(today.year, today.month, 1)
    if p > today:
        raise HTTPException(400, "That month hasn't started yet.")
    return p, (p.year, p.month) == (today.year, today.month)


def generate_report(industry: str, period, month_to_date: bool) -> None:
    report, text, cost, err = write_pack(industry, monthly_prompt(industry, period, month_to_date),
                                         f"report-{industry}-{period}", "monthly-report")
    try:
        acc.finish_report(ADMIN_DB_URL, industry, period, report, text, cost, err)
    except Exception as e:
        print(f"[report] could not save: {e}", flush=True)


@app.post("/admin/reports/{industry}/run")
def report_run(industry: str, req: Request, month: str | None = None, force: bool = False):
    """Write the monthly report for an industry (default: this month, month to date). Called by the reports workflow."""
    require_admin(req)
    if industry not in MONTHLY:
        raise HTTPException(404, "No monthly report for that industry.")
    if not (DB_URL and os.environ.get("ANTHROPIC_API_KEY")):
        raise HTTPException(503, "The analyst is not configured.")
    period, mtd = _period(month)
    try:
        return _report_start(industry, period, mtd, force)
    except Exception as e:   # admin-only endpoint: show the cause
        print(f"[report] run failed: {e.__class__.__name__}: {e}", flush=True)
        raise HTTPException(500, f"{e.__class__.__name__}: {str(e)[-700:]}")


def _report_start(industry: str, period, mtd: bool, force: bool) -> dict:
    key = f"{industry}:{period}"
    th = _report_threads.get(key)
    started = False
    if not (th and th.is_alive()) and acc.claim_report(ADMIN_DB_URL, industry, period, mtd, force):
        th = threading.Thread(target=generate_report, args=(industry, period, mtd), daemon=True)
        _report_threads[key] = th
        th.start()
        started = True
    return {"started": started, "period": str(period), "month_to_date": mtd,
            "status": acc.report_status(ADMIN_DB_URL, industry, period)}


@app.get("/admin/reports/{industry}")
def report_admin_status(industry: str, req: Request, month: str | None = None):
    require_admin(req)
    period, _ = _period(month)
    try:
        return {"period": str(period), **acc.report_status(ADMIN_DB_URL, industry, period, with_error=True)}
    except Exception as e:
        raise HTTPException(500, f"{e.__class__.__name__}: {str(e)[-700:]}")


@app.get("/reports")
def reports_public():
    """Published monthly reports (public sample packs; market data only)."""
    return {"reports": acc.list_reports(ADMIN_DB_URL)}


@app.get("/reports/{rid}")
def report_public(rid: int):
    r = acc.get_report(ADMIN_DB_URL, rid)
    if not r:
        raise HTTPException(404, "Report not found.")
    return r


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


class CreditIn(BaseModel):
    balance_usd: float = Field(gt=0, le=100000)
    step_pct: int = Field(default=10, ge=1, le=50)   # alert at every N% of the top-up used


@app.get("/admin/credit")
def admin_credit(req: Request):
    require_admin(req)
    return {"credit": acc.credit_status(ADMIN_DB_URL), "alerts": acc.recent_alerts(ADMIN_DB_URL)}


@app.post("/admin/credit")
def admin_set_credit(body: CreditIn, req: Request):
    """The owner records the balance shown in the Anthropic Console after a top-up, and the alert threshold."""
    require_admin(req)
    return acc.set_credit(ADMIN_DB_URL, body.balance_usd, body.step_pct)


@app.get("/admin/alerts/pending")
def admin_alerts_pending(req: Request):
    """For the hourly alerts workflow: alerts not yet sent (it opens a GitHub issue, which emails the owner)."""
    require_admin(req)
    return {"alerts": acc.pending_alerts(ADMIN_DB_URL)}


class AckIn(BaseModel):
    ids: list[int]


@app.post("/admin/alerts/ack")
def admin_alerts_ack(body: AckIn, req: Request):
    require_admin(req)
    acc.mark_notified(ADMIN_DB_URL, body.ids)
    return {"ok": True}


# ---------------------------------------------------------------- Acolyte's own sales CRM (admin only)
from . import prospects as sales


def _sales(fn):
    try:
        return fn()
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/admin/sales")
def sales_board(req: Request, analyst: str = "property"):
    require_admin(req)
    if analyst not in sales.ANALYSTS:
        raise HTTPException(400, "Unknown analyst.")
    return sales.board(ADMIN_DB_URL, analyst)


@app.post("/admin/sales/score")
def sales_score(req: Request, analyst: str | None = None):
    """Re-rank prospects from the latest data (daily after the refresh, or on demand)."""
    require_admin(req)
    out = {}
    for a in ([analyst] if analyst else sales.ANALYSTS):
        try:
            out[a] = sales.score(DB_URL, ADMIN_DB_URL, a)
        except Exception as e:
            out[a] = f"failed: {e.__class__.__name__}: {str(e)[:200]}"
    return out


class ProspectPatch(BaseModel):
    stage: str | None = Field(default=None, pattern="^(prospect|researching|contacted|meeting|proposal|won|lost)$")
    pinned: bool | None = None
    website: str | None = Field(default=None, max_length=300)
    contact_name: str | None = Field(default=None, max_length=120)
    contact_role: str | None = Field(default=None, max_length=120)
    contact_email: str | None = Field(default=None, max_length=200)
    next_step: str | None = Field(default=None, max_length=300)
    next_date: str | None = Field(default=None, pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    value_zar: float | None = Field(default=None, ge=0, le=10_000_000)
    notes: str | None = Field(default=None, max_length=5000)


@app.patch("/admin/sales/{pid}")
def sales_update(pid: int, body: ProspectPatch, req: Request):
    require_admin(req)
    patch = body.model_dump(exclude_unset=True)
    if patch.get("next_date") == "":
        patch["next_date"] = None
    return _sales(lambda: sales.update(ADMIN_DB_URL, pid, patch))


@app.get("/admin/sales/{pid}")
def sales_get(pid: int, req: Request):
    require_admin(req)
    p = sales.get(ADMIN_DB_URL, pid)
    if not p:
        raise HTTPException(404, "Prospect not found.")
    return {"prospect": p, "activities": sales.activities(ADMIN_DB_URL, pid)}


class ActivityIn(BaseModel):
    kind: str = Field(default="note", pattern="^(note|call|meeting|email)$")
    text: str = Field(min_length=1, max_length=5000)


@app.post("/admin/sales/{pid}/activities")
def sales_activity(pid: int, body: ActivityIn, req: Request):
    require_admin(req)
    sales.add_activity(ADMIN_DB_URL, pid, body.kind, body.text)
    return {"activities": sales.activities(ADMIN_DB_URL, pid)}


@app.post("/admin/sales/{pid}/draft")
def sales_draft(pid: int, req: Request):
    """Draft a first email from the prospect's data-backed reasons. Never sends anything."""
    require_admin(req)
    p = sales.get(ADMIN_DB_URL, pid)
    if not p:
        raise HTTPException(404, "Prospect not found.")
    if p["suppressed"]:
        raise HTTPException(409, "This business or address asked not to be contacted.")
    t0 = time.time()
    model = TIERS["standard"]["model"]
    try:
        msg = client().messages.create(model=model, max_tokens=1200, messages=[{"role": "user", "content": sales.draft_prompt(p)}])
    except Exception as e:
        acc.add_alert(ADMIN_DB_URL, "ai_error", f"[sales draft] {e.__class__.__name__}: {str(e)[:400]}")
        raise HTTPException(503, "The AI service is unavailable right now. Try again shortly.")
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    usd, t = cost_of(msg.model or model, msg.usage)
    log_usage({"account_id": None, "visitor": "sales-draft", "session_id": f"sales-{pid}", "country": None,
               "question": f"[sales draft] {p['name']}", "mode": "standard", "tier": "standard", "models": [msg.model or model],
               "status": "done", "error": None, "queries": "[]", "charts": 0, "report": False, "cost_usd": usd,
               "input": t["input"], "cache_read": t["cache_read"], "cache_write": t["cache_write"], "output": t["output"],
               "duration_ms": int((time.time() - t0) * 1000)})
    sales.add_activity(ADMIN_DB_URL, pid, "email_draft", text)
    return {"draft": text, "activities": sales.activities(ADMIN_DB_URL, pid)}


class SuppressIn(BaseModel):
    value: str = Field(min_length=2, max_length=200)
    reason: str = Field(default="asked not to be contacted", max_length=200)


@app.post("/admin/sales/suppress")
def sales_suppress(body: SuppressIn, req: Request):
    require_admin(req)
    sales.suppress(ADMIN_DB_URL, body.value, body.reason)
    return {"ok": True}


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


@app.get("/brand")
def my_brand(account: dict = Depends(need_account)):
    """The signed-in client's report branding (None = Acolyte's own)."""
    return {"brand": acc.get_brand(ADMIN_DB_URL, account["id"])}


class BrandIn(BaseModel):
    brand: dict | None = None


@app.get("/admin/accounts/{aid}/brand")
def admin_brand(aid: int, req: Request):
    require_admin(req)
    return {"brand": acc.get_brand(ADMIN_DB_URL, aid), "presets": acc.BRAND_PRESETS}


@app.put("/admin/accounts/{aid}/brand")
def admin_brand_set(aid: int, body: BrandIn, req: Request):
    require_admin(req)
    return {"brand": guard(lambda: acc.set_brand(ADMIN_DB_URL, aid, body.brand))}


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
