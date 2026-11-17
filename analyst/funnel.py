"""The sales funnel the platform runs on its own (hourly and after the daily data refresh).

  1. Assign    top-ranked, unassigned prospects to active agents who sell that analyst, round-robin, up to each
               agent's open-lead limit (marks them Researching and puts them on the board).
  2. Draft     once an agent adds a business email: one permission email (POPIA s69 allows one unsolicited approach,
               asking whether we may send more). After a "yes": the monthly pack + demo invite, then follow-ups.
  3. Send      approved emails due now, from the sales mailbox (SMTP), at most N a day; or hand them to the agent to
               send from their own mail app when no mailbox is set up.
  4. Close     no reply N days after the permission email: stop (no second unsolicited email), mark Lost.
  5. Notify    each agent once a run (ZeptoMail): new leads, drafts waiting for approval, follow-ups due today.
Nothing here ever emails a business that opted out or is on the suppression list.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import psycopg

from . import mail
from .prospects import ANALYST_NAME, _rows

SITE = "https://acolytegroup.co.za"


def settings(db: str) -> dict:
    with psycopg.connect(db) as conn:
        return {k: v for k, v in conn.execute("SELECT key, value FROM sales.settings").fetchall()}


def set_settings(db: str, patch: dict) -> dict:
    allowed = {"auto_assign": bool, "assign_per_run": int, "auto_draft": bool, "auto_send": bool, "daily_send_cap": int,
               "followup_days": list, "no_reply_days": int, "notify_agents": bool}
    with psycopg.connect(db) as conn:
        for k, v in patch.items():
            if k in allowed and isinstance(v, allowed[k]):
                conn.execute("INSERT INTO sales.settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                             (k, json.dumps(v)))
    return settings(db)


def _suppressed(conn, p: dict) -> bool:
    email = (p.get("contact_email") or "").lower()
    return bool(conn.execute("SELECT 1 FROM sales.suppression WHERE lower(value) IN (lower(%s), %s, %s)",
                             (p["name"], email, email.split("@")[-1] if email else "")).fetchone())


def _log(conn, pid: int, kind: str, text: str) -> None:
    conn.execute("INSERT INTO sales.activities (prospect_id, kind, text) VALUES (%s, %s, %s)", (pid, kind, text[:5000]))


# ---------------------------------------------------------------- 1. assignment
def assign(db: str, per_run: int) -> list[dict]:
    """Round-robin the best unassigned prospects to agents with spare capacity. Returns the assignments made."""
    made = []
    with psycopg.connect(db) as conn:
        agents = _rows(conn, """SELECT a.id, a.name, a.email, a.analysts, a.max_open,
                                       (SELECT count(*) FROM sales.prospects p WHERE p.agent_id = a.id AND p.stage NOT IN ('won', 'lost')) AS open
                                FROM sales.agents a WHERE a.active ORDER BY a.id""")
        if not agents:
            return made
        for analyst in ANALYST_NAME:
            team = [a for a in agents if analyst in (a["analysts"] or [])]
            if not team:
                continue
            leads = _rows(conn, """SELECT id, name, contact_email FROM sales.prospects
                                   WHERE analyst = %s AND agent_id IS NULL AND stage = 'prospect'
                                     AND (rank IS NOT NULL OR EXISTS (SELECT 1 FROM sales.enquiries e WHERE e.prospect_id = sales.prospects.id))
                                     AND consent NOT IN ('declined', 'opted_out')
                                   -- website enquiries first (warm leads), oldest first; then the ranked list
                                   ORDER BY (SELECT min(e.at) FROM sales.enquiries e WHERE e.prospect_id = sales.prospects.id) NULLS LAST, rank
                                   LIMIT %s""", (analyst, per_run))
            for p in leads:
                if _suppressed(conn, {**p}):
                    continue
                free = [a for a in team if a["open"] < a["max_open"]]
                if not free:
                    break
                a = min(free, key=lambda a: (a["open"], a["id"]))   # least loaded agent first, so leads alternate
                conn.execute("""UPDATE sales.prospects SET agent_id = %s, assigned_at = now(), pinned = TRUE, stage = 'researching',
                                updated_at = now() WHERE id = %s""", (a["id"], p["id"]))
                _log(conn, p["id"], "stage", f"Assigned to {a['name']} by the funnel")
                a["open"] += 1
                made.append({"agent_id": a["id"], "prospect": p["name"], "analyst": analyst})
    return made


# ---------------------------------------------------------------- 2. drafting
def _latest_report(conn, analyst: str) -> str | None:
    r = conn.execute("""SELECT id FROM admin.reports WHERE industry = %s AND status = 'ready' AND published
                        ORDER BY period DESC LIMIT 1""", ("jobs" if analyst == "jobs" else analyst,)).fetchone()
    return f"{SITE}/reports/#report-{r[0]}" if r else None


def _prompt(p: dict, kind: str, step: int, agent: dict | None, report_url: str | None) -> str:
    who = f"{p['contact_name']} ({p.get('contact_role') or 'decision maker'})" if p.get("contact_name") else "the decision maker"
    sign = f"{agent['name']}, Acolyte" if agent else "The Acolyte team"
    facts = "\n".join("- " + x for x in (p.get("reasons") or []))
    base = (f"Write a plain-text email from {sign} (a South African AI analytics company) to {who} at {p['name']} "
            f"({p.get('segment') or 'business'}). Product: the Acolyte {ANALYST_NAME[p['analyst']]}, an AI analyst on live SA market data "
            f"with daily briefs, dashboards and monthly report packs. Facts about them from our data (use 1-2, exactly as given):\n{facts}\n"
            f"Lead with: {p.get('pitch')}\nRules: South African English, specific, no hype, no invented numbers or claims. "
            "Start with a line 'Subject: ...', then the body. Sign off as " + sign + ".\n")
    if kind == "permission":
        return base + ("This is the ONLY unsolicited email we may send (POPIA). Max 110 words. Do not pitch a meeting. Ask one "
                       "question: may we send them our free monthly report on their market? Say clearly that if they don't reply "
                       "we won't email again. End with: 'Reply \"no thanks\" and we won't contact you again.'")
    if kind == "pack":
        return base + (f"They said yes to hearing more. Max 140 words. Thank them, share this month's report: {report_url or 'attached on request'}, "
                       "point to one finding relevant to them, and offer a 20-minute demo on their own market. Include the opt-out line "
                       "'Reply \"unsubscribe\" any time and we'll stop.'")
    return base + (f"Follow-up #{step} after they agreed to hear from us. Max 90 words, friendly, one new useful fact from the list, "
                   "one clear ask (a 20-minute demo). Include 'Reply \"unsubscribe\" any time and we'll stop.'")


def _split(text: str) -> tuple[str, str]:
    m = re.match(r"\s*Subject:\s*(.+?)\s*\n(.*)", text, re.S)
    return (m.group(1).strip(), m.group(2).strip()) if m else ("A quick question", text.strip())


def draft_due(db: str, ai, s: dict, limit: int = 15) -> int:
    """Create the next email for every prospect that needs one. `ai(prompt) -> text` writes it."""
    made = 0
    fdays = [int(x) for x in (s.get("followup_days") or [3, 10])][:3]
    with psycopg.connect(db) as conn:
        todo = _rows(conn, """
            SELECT p.*, a.name AS agent_name, a.email AS agent_email,
                   (SELECT max(step) FROM sales.outbox o WHERE o.prospect_id = p.id AND o.kind = 'followup') AS last_followup,
                   EXISTS (SELECT 1 FROM sales.outbox o WHERE o.prospect_id = p.id AND o.kind = 'permission') AS asked,
                   EXISTS (SELECT 1 FROM sales.outbox o WHERE o.prospect_id = p.id AND o.kind = 'pack') AS packed,
                   EXISTS (SELECT 1 FROM sales.outbox o WHERE o.prospect_id = p.id AND o.status IN ('draft', 'approved', 'failed')) AS pending,
                   (SELECT max(sent_at) FROM sales.outbox o WHERE o.prospect_id = p.id AND o.kind IN ('pack', 'followup')
                      AND o.status IN ('sent', 'manual')) AS last_sent
            FROM sales.prospects p LEFT JOIN sales.agents a ON a.id = p.agent_id
            WHERE p.contact_email IS NOT NULL AND p.contact_email <> '' AND p.stage NOT IN ('won', 'lost')
              AND p.consent IN ('unknown', 'granted')
            ORDER BY p.rank NULLS LAST LIMIT 200""")
        for p in todo:
            if made >= limit:
                break
            if p["pending"] or _suppressed(conn, p):   # one email in flight per prospect at a time
                continue
            agent = {"name": p["agent_name"], "email": p["agent_email"]} if p["agent_name"] else None
            if p["consent"] == "unknown" and not p["asked"]:
                kind, step, due = "permission", 1, datetime.now(timezone.utc)
            elif p["consent"] == "granted" and not p["packed"]:
                kind, step, due = "pack", 1, datetime.now(timezone.utc)
            elif p["consent"] == "granted" and p["packed"] and p["stage"] in ("contacted", "researching"):
                step = (p["last_followup"] or 0) + 1
                if step > len(fdays) or not p["last_sent"]:
                    continue
                kind, due = "followup", datetime.fromisoformat(str(p["last_sent"])) + timedelta(days=fdays[step - 1])
            else:
                continue
            report = _latest_report(conn, p["analyst"]) if kind != "permission" else None
            subject, body = _split(ai(_prompt(p, kind, step, agent, report)))
            status = "approved" if s.get("auto_send") else "draft"
            conn.execute("""INSERT INTO sales.outbox (prospect_id, agent_id, kind, step, to_email, subject, body, status, due_at)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (prospect_id, kind, step) DO NOTHING""",
                         (p["id"], p["agent_id"], kind, step, p["contact_email"], subject, body, status, due))
            _log(conn, p["id"], "email_draft", f"{kind.title()} email drafted ({'auto-approved' if status == 'approved' else 'waiting for approval'}): {subject}")
            made += 1
    return made


# ---------------------------------------------------------------- 3. sending
def send_due(db: str, s: dict) -> dict:
    """Send approved emails that are due, within the daily cap. Without a sales mailbox they wait for the agent."""
    out = {"sent": 0, "failed": 0, "waiting_for_agent": 0}
    cap = int(s.get("daily_send_cap") or 20)
    with psycopg.connect(db) as conn:
        today = conn.execute("SELECT count(*) FROM sales.outbox WHERE transport IN ('smtp', 'brevo') AND sent_at >= date_trunc('day', now())").fetchone()[0]
        queue = _rows(conn, """SELECT o.*, p.name, p.contact_name, p.consent, p.stage, a.email AS agent_email, a.name AS agent_name
                               FROM sales.outbox o JOIN sales.prospects p ON p.id = o.prospect_id
                               LEFT JOIN sales.agents a ON a.id = o.agent_id
                               WHERE o.status = 'approved' AND o.due_at <= now() ORDER BY o.due_at LIMIT %s""", (max(0, cap - today),))
        for o in queue:
            # re-check right before sending: consent and opt-outs can change after a draft was approved
            ok = (o["kind"] == "permission" and o["consent"] == "unknown") or (o["kind"] != "permission" and o["consent"] == "granted")
            if not ok or o["stage"] in ("won", "lost") or _suppressed(conn, {"name": o["name"], "contact_email": o["to_email"]}):
                conn.execute("UPDATE sales.outbox SET status = 'skipped', error = 'consent or stage changed' WHERE id = %s", (o["id"],))
                continue
            # The permission email only ever goes 1:1 from the sales mailbox; consented mail may use Brevo.
            if o["kind"] == "permission":
                if not mail.smtp_ready():
                    out["waiting_for_agent"] += 1
                    continue
                transport, send = "smtp", lambda: mail.send_outreach(o["to_email"], o["contact_name"] or "", o["subject"], o["body"],
                                                                     o["agent_email"], f"acolyte-{o['id']}")
            else:
                if not (mail.brevo_ready() or mail.smtp_ready()):
                    out["waiting_for_agent"] += 1
                    continue
                transport = "brevo" if mail.brevo_ready() else "smtp"
                send = lambda: mail.send_consented(o["to_email"], o["contact_name"] or "", o["subject"], o["body"],
                                                   o["agent_email"], f"acolyte-{o['id']}")
            try:
                send()
            except RuntimeError as e:
                conn.execute("UPDATE sales.outbox SET status = 'failed', error = %s WHERE id = %s", (str(e)[:500], o["id"]))
                out["failed"] += 1
                continue
            mark_sent(conn, o, transport)
            out["sent"] += 1
    return out


def mark_sent(conn, o: dict, transport: str) -> None:
    conn.execute("UPDATE sales.outbox SET status = %s, sent_at = now(), transport = %s, error = NULL WHERE id = %s",
                 ("manual" if transport == "manual" else "sent", transport, o["id"]))
    extra = ", consent = 'requested', consent_at = now()" if o["kind"] == "permission" else ""
    conn.execute(f"""UPDATE sales.prospects SET last_emailed_at = now(), updated_at = now(),
                     stage = CASE WHEN stage IN ('prospect', 'researching') THEN 'contacted' ELSE stage END{extra}
                     WHERE id = %s""", (o["prospect_id"],))
    _log(conn, o["prospect_id"], "email", f"{o['kind'].title()} email sent{' by the agent' if transport == 'manual' else ''}: {o['subject']}")


# ---------------------------------------------------------------- 4. closing
def close_stale(db: str, days: int) -> int:
    with psycopg.connect(db) as conn:
        rows = _rows(conn, """UPDATE sales.prospects SET consent = 'no_response', stage = 'lost', updated_at = now()
                              WHERE consent = 'requested' AND consent_at < now() - make_interval(days => %s) AND stage NOT IN ('won', 'lost', 'meeting', 'proposal')
                              RETURNING id""", (days,))
        for r in rows:
            _log(conn, r["id"], "stage", f"No reply {days} days after the permission email: closed, and no further emails (POPIA).")
        conn.execute("UPDATE sales.outbox SET status = 'skipped', error = 'prospect closed' WHERE status IN ('draft', 'approved') AND prospect_id = ANY(%s)",
                     ([r["id"] for r in rows],))
    return len(rows)


# ---------------------------------------------------------------- 5. notifying agents
def notify(db: str, assigned: list[dict]) -> int:
    if not mail.system_ready():
        return 0
    sent = 0
    with psycopg.connect(db) as conn:
        agents = _rows(conn, "SELECT id, name, email FROM sales.agents WHERE active")
        for a in agents:
            new = [x for x in assigned if x["agent_id"] == a["id"]]
            drafts = conn.execute("SELECT count(*) FROM sales.outbox WHERE agent_id = %s AND status = 'draft'", (a["id"],)).fetchone()[0]
            manual = conn.execute("""SELECT count(*) FROM sales.outbox WHERE agent_id = %s AND status = 'approved' AND due_at <= now()
                                     AND (kind = 'permission' AND %s OR kind <> 'permission' AND %s)""",
                                  (a["id"], not mail.smtp_ready(), not (mail.brevo_ready() or mail.smtp_ready()))).fetchone()[0]
            due = _rows(conn, """SELECT name, next_step FROM sales.prospects WHERE agent_id = %s AND next_date <= current_date
                                 AND stage NOT IN ('won', 'lost') ORDER BY next_date LIMIT 10""", (a["id"],))
            missing = conn.execute("""SELECT count(*) FROM sales.prospects WHERE agent_id = %s AND stage = 'researching'
                                      AND (contact_email IS NULL OR contact_email = '')""", (a["id"],)).fetchone()[0]
            if not (new or drafts or manual or due):
                continue
            lines = [f"Hi {a['name'].split()[0]},", ""]
            if new:
                lines += [f"New leads assigned to you ({len(new)}):"] + [f"- {x['prospect']} ({ANALYST_NAME[x['analyst']]})" for x in new] + [""]
            if missing:
                lines += [f"{missing} of your leads need a business contact email before the first email can be drafted.", ""]
            if drafts:
                lines += [f"{drafts} email draft(s) are waiting for your approval in the CRM Outbox.", ""]
            if manual:
                lines += [f"{manual} approved email(s) are ready for you to send from your own mail app.", ""]
            if due:
                lines += ["Follow-ups due today:"] + [f"- {d['name']}: {d['next_step'] or 'follow up'}" for d in due] + [""]
            lines += [f"Open the CRM: {SITE}/crm/", "", "Acolyte"]
            try:
                mail.send_system([(a["email"], a["name"])], f"Acolyte CRM: {len(new)} new lead(s), {drafts} draft(s) to approve",
                                "\n".join(lines), f"crm-digest-{a['id']}")
                sent += 1
            except RuntimeError as e:
                print(f"[funnel] agent email failed for agent {a['id']}: {e}", flush=True)
    return sent


def run(db: str, ai) -> dict:
    s = settings(db)
    assigned = assign(db, int(s.get("assign_per_run") or 5)) if s.get("auto_assign") else []
    drafted = draft_due(db, ai, s) if s.get("auto_draft") else 0
    sending = send_due(db, s)
    closed = close_stale(db, int(s.get("no_reply_days") or 14))
    notified = notify(db, assigned) if s.get("notify_agents") else 0
    return {"assigned": len(assigned), "drafted": drafted, **sending, "closed": closed, "agents_notified": notified}
