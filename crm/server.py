"""Acolyte CRM: a small private server on YOUR computer that connects the CRM page to your Neon database.

    pip install -r requirements.txt          # once
    python crm/server.py                     # then open the CRM page it prints

Reads DATABASE_URL from .env (the same Neon connection string as the GitHub secret). It only listens on
127.0.0.1, so nobody else on the internet or your network can reach it, and only the Acolyte site
(or a local copy of it) is allowed to call it. Contact details never leave your database.
"""
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from db import connect, init_db  # noqa: E402

PORT = int(os.environ.get("CRM_PORT", "8787"))
ALLOWED_ORIGINS = {"https://dumichanda.github.io", "http://localhost:5173", "http://localhost:4173",
                   "http://127.0.0.1:5173", "http://127.0.0.1:4173", f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
STAGES = ["new", "researching", "contacted", "replied", "meeting", "proposal", "won", "lost", "not_a_fit"]
CONSENT = ["unknown", "requested", "granted", "declined", "opted_out"]


def enc(o):
    if isinstance(o, Decimal):
        return float(o)
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError(type(o))


def q(conn, sql, params=None, one=False):
    cur = conn.execute(sql, params or ())
    if cur.description is None:
        return None
    cols = [c.name for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return (rows[0] if rows else None) if one else rows


class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


# ---------------------------------------------------------------- endpoints
def pipeline(conn, _body):
    rows = q(conn, """
        SELECT o.id, o.stage, o.est_value, o.pitch, o.next_action, o.next_action_at, o.updated_at,
               c.id AS company_id, c.name, c.website, c.industry, c.hq_city, c.hq_province,
               l.open_roles, l.avg_score, l.main_family,
               (SELECT count(*) FROM contacts k WHERE k.company_id = c.id) AS contacts,
               (SELECT count(*) FROM contacts k WHERE k.company_id = c.id AND k.email IS NOT NULL) AS emails,
               (SELECT count(*) FROM activities a WHERE a.opportunity_id = o.id AND a.kind = 'email_draft') AS drafts,
               (SELECT max(created_at) FROM activities a WHERE a.opportunity_id = o.id AND a.kind <> 'email_draft') AS last_touch
        FROM opportunities o JOIN companies c ON c.id = o.company_id
        LEFT JOIN v_company_leads l ON l.id = c.id
        ORDER BY o.est_value DESC NULLS LAST""")
    stats = q(conn, """SELECT
        (SELECT count(*) FROM opportunities) AS opportunities,
        (SELECT count(*) FROM activities WHERE kind = 'email_sent') AS sent,
        (SELECT count(*) FROM activities WHERE kind = 'reply') AS replies,
        (SELECT count(*) FROM opportunities WHERE stage IN ('meeting','proposal')) AS meetings,
        (SELECT count(*) FROM opportunities WHERE stage = 'won') AS won,
        (SELECT count(*) FROM opportunities WHERE next_action_at <= current_date
                AND stage NOT IN ('won','lost','not_a_fit')) AS due""", one=True)
    return {"stages": STAGES, "opportunities": rows, "stats": stats}


def opportunity(conn, oid):
    o = q(conn, """SELECT o.*, c.name, c.website, c.industry, c.size_band, c.hq_city, c.hq_province, c.linkedin_url,
                          c.description, c.is_recruiter, l.open_roles, l.avg_score, l.main_family, l.automatable_value
                   FROM opportunities o JOIN companies c ON c.id = o.company_id
                   LEFT JOIN v_company_leads l ON l.id = c.id WHERE o.id = %s""", (oid,), one=True)
    if not o:
        raise ApiError(404, "opportunity not found")
    o["contacts"] = q(conn, """SELECT k.*, EXISTS (SELECT 1 FROM suppression s WHERE s.value = lower(k.email)
                                  OR s.value = split_part(lower(k.email), '@', 2)) AS suppressed
                               FROM contacts k WHERE company_id = %s ORDER BY is_generic, id""", (o["company_id"],))
    o["activities"] = q(conn, "SELECT * FROM activities WHERE opportunity_id = %s ORDER BY created_at DESC", (oid,))
    o["roles"] = q(conn, """SELECT v.title, v.url, v.city, v.posted_at::date AS posted, v.automation_score AS score,
                                   v.automatable_value_zar AS value, v.role_family AS family, i.tools, i.skills
                            FROM v_jobs_value v LEFT JOIN job_insights i ON i.job_id = v.id
                            WHERE v.company_id = %s ORDER BY v.automatable_value_zar DESC NULLS LAST LIMIT 25""",
                         (o["company_id"],))
    return o


def update_opportunity(conn, oid, b):
    cur = q(conn, "SELECT stage FROM opportunities WHERE id = %s", (oid,), one=True)
    if not cur:
        raise ApiError(404, "opportunity not found")
    if "stage" in b and b["stage"] not in STAGES:
        raise ApiError(400, "unknown stage")
    fields = {k: b[k] for k in ("stage", "next_action", "next_action_at") if k in b}
    if fields:
        sets = ", ".join(f"{k} = %s" for k in fields)
        conn.execute(f"UPDATE opportunities SET {sets}, updated_at = now() WHERE id = %s",
                     [*(v or None for v in fields.values()), oid])
    if b.get("stage") and b["stage"] != cur["stage"]:
        add_activity(conn, oid, {"kind": "stage", "subject": f"{cur['stage']} → {b['stage']}"})
    return opportunity(conn, oid)


def add_activity(conn, oid, b):
    if b.get("kind") not in ("email_draft", "email_sent", "reply", "call", "meeting", "note", "stage"):
        raise ApiError(400, "unknown activity kind")
    comp = q(conn, "SELECT company_id FROM opportunities WHERE id = %s", (oid,), one=True)
    if not comp:
        raise ApiError(404, "opportunity not found")
    conn.execute("""INSERT INTO activities (opportunity_id, company_id, contact_id, kind, subject, body, meta)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                 (oid, comp["company_id"], b.get("contact_id"), b["kind"], b.get("subject"), b.get("body"),
                  json.dumps(b.get("meta") or {})))
    conn.execute("UPDATE opportunities SET updated_at = now() WHERE id = %s", (oid,))
    return {"ok": True}


def edit_activity(conn, aid, b):
    conn.execute("UPDATE activities SET subject = %s, body = %s WHERE id = %s AND kind = 'email_draft'",
                 (b.get("subject"), b.get("body"), aid))
    return {"ok": True}


def mark_sent(conn, oid, b):
    """You sent the email from your own mailbox: log it, mark consent as requested, set a follow-up."""
    k = q(conn, "SELECT * FROM contacts WHERE id = %s", (b.get("contact_id"),), one=True)
    if not k or not k["email"]:
        raise ApiError(400, "pick a contact with an email address")
    blocked = q(conn, "SELECT 1 FROM suppression WHERE value = lower(%s) OR value = split_part(lower(%s), '@', 2)",
                (k["email"], k["email"]), one=True)
    if blocked:
        raise ApiError(409, f"{k['email']} has opted out; it must not be contacted")
    add_activity(conn, oid, {"kind": "email_sent", "contact_id": k["id"], "subject": b.get("subject"),
                             "body": b.get("body"), "meta": {"to": k["email"]}})
    if b.get("draft_id"):
        conn.execute("DELETE FROM activities WHERE id = %s AND kind = 'email_draft'", (b["draft_id"],))
    if k["consent_status"] == "unknown":
        conn.execute("UPDATE contacts SET consent_status = 'requested', consent_at = now() WHERE id = %s", (k["id"],))
    conn.execute("""UPDATE opportunities SET stage = CASE WHEN stage IN ('new','researching') THEN 'contacted' ELSE stage END,
                           next_action = 'Follow up if no reply (once only)', next_action_at = current_date + 7,
                           updated_at = now() WHERE id = %s""", (oid,))
    return opportunity(conn, oid)


def log_reply(conn, oid, b):
    """outcome: granted (happy to hear more) | declined | opted_out | other"""
    outcome = b.get("outcome", "other")
    k = q(conn, "SELECT * FROM contacts WHERE id = %s", (b.get("contact_id"),), one=True)
    add_activity(conn, oid, {"kind": "reply", "contact_id": b.get("contact_id"), "subject": f"Reply: {outcome}",
                             "body": b.get("body"), "meta": {"outcome": outcome}})
    if k and outcome in ("granted", "declined", "opted_out"):
        conn.execute("UPDATE contacts SET consent_status = %s, consent_at = now() WHERE id = %s", (outcome, k["id"]))
    if k and k["email"] and outcome in ("declined", "opted_out"):
        conn.execute("INSERT INTO suppression (value, reason) VALUES (lower(%s), %s) ON CONFLICT DO NOTHING",
                     (k["email"], f"{outcome} via reply"))
    stage = {"granted": "replied", "declined": "not_a_fit", "opted_out": "not_a_fit"}.get(outcome, "replied")
    nxt = {"granted": ("Send the one-page idea and propose a call", 2)}.get(outcome, (None, None))
    conn.execute("""UPDATE opportunities SET stage = %s, next_action = %s,
                           next_action_at = CASE WHEN %s::int IS NULL THEN NULL ELSE current_date + %s::int END,
                           updated_at = now() WHERE id = %s""", (stage, nxt[0], nxt[1], nxt[1], oid))
    return opportunity(conn, oid)


def save_contact(conn, b, cid=None):
    if "consent_status" in b and b["consent_status"] not in CONSENT:
        raise ApiError(400, "unknown consent status")
    fields = {k: (b[k] or None) for k in ("name", "role", "email", "phone", "linkedin_url", "source", "notes",
                                           "consent_status", "is_generic") if k in b}
    if "email" in fields and fields["email"]:
        fields["email"] = fields["email"].strip().lower()
    if cid:
        sets = ", ".join(f"{k} = %s" for k in fields)
        conn.execute(f"UPDATE contacts SET {sets} WHERE id = %s", [*fields.values(), cid])
        if fields.get("consent_status") == "opted_out":
            conn.execute("""INSERT INTO suppression (value, reason) SELECT lower(email), 'opted out' FROM contacts
                            WHERE id = %s AND email IS NOT NULL ON CONFLICT DO NOTHING""", (cid,))
    else:
        if not b.get("company_id"):
            raise ApiError(400, "company_id is required")
        fields.setdefault("is_generic", not b.get("name"))
        fields["company_id"] = b["company_id"]
        cols = ", ".join(fields)
        conn.execute(f"INSERT INTO contacts ({cols}) VALUES ({', '.join(['%s'] * len(fields))})", list(fields.values()))
    return {"ok": True}


def suppress(conn, b):
    v = (b.get("value") or "").strip().lower()
    if not v:
        raise ApiError(400, "value is required")
    conn.execute("INSERT INTO suppression (value, reason) VALUES (%s, %s) ON CONFLICT (value) DO NOTHING", (v, b.get("reason")))
    return {"ok": True}


def agent_runs(conn, _b):
    return {"runs": q(conn, """SELECT id, agent, model, status, steps, tool_calls, cost_usd, left(summary, 600) AS summary,
                                      error, started_at, finished_at FROM agent_runs ORDER BY id DESC LIMIT 40""")}


def agent_run(conn, rid):
    run = q(conn, "SELECT * FROM agent_runs WHERE id = %s", (rid,), one=True)
    if not run:
        raise ApiError(404, "run not found")
    run["steps"] = q(conn, "SELECT n, kind, name, input, output, is_error, cost_usd, created_at FROM agent_steps "
                           "WHERE run_id = %s ORDER BY id", (rid,))
    return run


ROUTES = [
    ("GET", "/api/agents", lambda c, b, *a: agent_runs(c, b)),
    ("GET", "/api/agents/{id}", lambda c, b, i: agent_run(c, i)),
    ("GET", "/api/health", lambda c, b, *a: {"ok": True}),
    ("GET", "/api/pipeline", lambda c, b, *a: pipeline(c, b)),
    ("GET", "/api/opportunity/{id}", lambda c, b, i: opportunity(c, i)),
    ("POST", "/api/opportunity/{id}", lambda c, b, i: update_opportunity(c, i, b)),
    ("POST", "/api/opportunity/{id}/activity", lambda c, b, i: add_activity(c, i, b)),
    ("POST", "/api/opportunity/{id}/sent", lambda c, b, i: mark_sent(c, i, b)),
    ("POST", "/api/opportunity/{id}/reply", lambda c, b, i: log_reply(c, i, b)),
    ("POST", "/api/activity/{id}", lambda c, b, i: edit_activity(c, i, b)),
    ("POST", "/api/contact", lambda c, b, *a: save_contact(c, b)),
    ("POST", "/api/contact/{id}", lambda c, b, i: save_contact(c, b, i)),
    ("POST", "/api/suppress", lambda c, b, *a: suppress(c, b)),
]


def match(method, path):
    parts = path.rstrip("/").split("/")
    for m, pattern, fn in ROUTES:
        pp = pattern.split("/")
        if m != method or len(pp) != len(parts):
            continue
        args = []
        for a, b in zip(pp, parts):
            if a == "{id}":
                if not b.isdigit():
                    break
                args.append(int(b))
            elif a != b:
                break
        else:
            return fn, args
    return None, None


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, status, payload):
        data = json.dumps(payload, default=enc).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _handle(self, method):
        origin = self.headers.get("Origin")
        if origin and origin not in ALLOWED_ORIGINS:
            return self._send(403, {"error": "origin not allowed"})
        path = self.path.split("?")[0]
        if method == "GET" and not path.startswith("/api/"):
            return self._static(path)
        fn, args = match(method, path)
        if not fn:
            return self._send(404, {"error": "not found"})
        body = {}
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except json.JSONDecodeError:
                return self._send(400, {"error": "invalid JSON"})
        try:
            with connect() as conn:
                result = fn(conn, body, *args)
                conn.commit()
            self._send(200, result)
        except ApiError as e:
            self._send(e.status, {"error": str(e)})
        except Exception as e:  # show database errors in the page instead of a silent failure
            self._send(500, {"error": f"{e.__class__.__name__}: {e}"})

    def _static(self, path):
        """Serve a local build of the site (web/dist) if there is one, so the CRM also works offline."""
        dist = ROOT / "web" / "dist"
        f = (dist / path.lstrip("/")).resolve()
        if f.is_dir():
            f = f / "index.html"
        if not dist.exists() or not str(f).startswith(str(dist.resolve())) or not f.exists():
            return self._send(404, {"error": "not found"})
        types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                 ".svg": "image/svg+xml", ".png": "image/png"}
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", types.get(f.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("  " + (fmt % args) + "\n")


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Acolyte CRM server running on http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    print("Open the CRM:  https://dumichanda.github.io/acolyte-site/crm/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
