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
import json
import os
import threading
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent import MODEL, TIERS, Budget, Session, answer

DB_URL = os.environ.get("ANALYST_DATABASE_URL", "")
ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS", "https://dumichanda.github.io,http://localhost:5173,http://localhost:4173").split(",") if o.strip()]
HOURLY = int(os.environ.get("ANALYST_HOURLY_LIMIT", "20"))
MAX_TURNS = 25
SESSION_TTL = 2 * 3600

app = FastAPI(title="Acolyte Analyst", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

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

    def stream():
        yield f"data: {json.dumps({'type': 'session', 'session_id': s.id})}\n\n"
        try:
            for ev in answer(client(), s, body.question.strip(), DB_URL, budget, body.mode):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:  # never leave the browser hanging
            yield f"data: {json.dumps({'type': 'error', 'text': f'Something went wrong ({e.__class__.__name__}).'})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
