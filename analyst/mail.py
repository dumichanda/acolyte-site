"""Email for the platform.

Three routes, because the rules differ:
- System mail (lead assignments, agents' daily tasks, owner alerts): Brevo or ZeptoMail over HTTPS if set up,
  otherwise the sales mailbox. A paid Zoho Mail mailbox alone runs the whole funnel; Brevo is an optional extra.
- Mail to prospects who said yes (the monthly pack, follow-ups): Brevo, which allows email to people who opted in;
  otherwise the sales mailbox. ZeptoMail is never used for this: its terms allow transactional email only.
- The single permission email (POPIA s69: one unsolicited approach) is a 1:1 email from a real sales mailbox over
  SMTP (e.g. Zoho Mail: smtppro.zoho.com:465), at a low daily rate with the agent as reply-to. No email provider allows
  cold email to people who never opted in. Without a mailbox, the agent sends it from their own mail app.

Settings (Render environment variables; secrets never in code):
  BREVO_API_KEY        Brevo > SMTP & API > API keys
  BREVO_FROM           a verified sender on your domain, e.g. hello@acolyte.co.za
  ZEPTOMAIL_TOKEN      "Send Mail" token from ZeptoMail > Mail Agents > SMTP/API (the part after "Zoho-enczapikey")
  ZEPTOMAIL_FROM       a verified sender on your domain, e.g. noreply@acolyte.co.za
  ZEPTOMAIL_HOST       api.zeptomail.com (default) or your data centre, e.g. api.zeptomail.eu, api.zeptomail.in
  OUTREACH_SMTP_HOST / OUTREACH_SMTP_PORT / OUTREACH_SMTP_USER / OUTREACH_SMTP_PASSWORD / OUTREACH_FROM
  INBOX_IMAP_HOST      reading the sales mailbox, e.g. imappro.zoho.com (paid Zoho plan); INBOX_IMAP_PORT (993),
                       INBOX_USER / INBOX_PASSWORD (default: the OUTREACH_SMTP_ ones), INBOX_FOLDER (default INBOX)
"""
from __future__ import annotations

import html
import json
import os
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid


def brevo_ready() -> bool:
    return bool(os.environ.get("BREVO_API_KEY") and os.environ.get("BREVO_FROM"))


def zepto_ready() -> bool:
    return bool(os.environ.get("ZEPTOMAIL_TOKEN") and os.environ.get("ZEPTOMAIL_FROM"))


def smtp_ready() -> bool:
    return all(os.environ.get(k) for k in ("OUTREACH_SMTP_HOST", "OUTREACH_SMTP_USER", "OUTREACH_SMTP_PASSWORD"))


def system_ready() -> bool:
    return brevo_ready() or zepto_ready() or smtp_ready()


def status() -> dict:
    return {"system": "brevo" if brevo_ready() else "zeptomail" if zepto_ready() else "smtp" if smtp_ready() else None,
            "consented": "brevo" if brevo_ready() else "smtp" if smtp_ready() else None,
            "permission": "smtp" if smtp_ready() else "manual",
            "inbox": "imap" if imap_ready() else None,
            "brevo_from": os.environ.get("BREVO_FROM", ""), "zeptomail_from": os.environ.get("ZEPTOMAIL_FROM", ""),
            "outreach_from": os.environ.get("OUTREACH_FROM") or os.environ.get("OUTREACH_SMTP_USER", "")}


def send_brevo(to: list[tuple[str, str]], subject: str, text: str, reply_to: str | None = None, tag: str = "") -> str:
    """Brevo transactional API (HTTPS). Returns the message id. Raises RuntimeError on failure."""
    if not brevo_ready():
        raise RuntimeError("Brevo is not set up (BREVO_API_KEY and BREVO_FROM on Render).")
    body = {"sender": {"email": os.environ["BREVO_FROM"], "name": os.environ.get("BREVO_FROM_NAME", "Acolyte")},
            "to": [{"email": a, **({"name": n} if n else {})} for a, n in to],
            "subject": subject[:250], "textContent": text, "htmlContent": _html(text),
            **({"replyTo": {"email": reply_to}} if reply_to else {}), **({"tags": [tag[:50]]} if tag else {})}
    req = urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(body).encode(), method="POST",
                                 headers={"api-key": os.environ["BREVO_API_KEY"].strip(), "Content-Type": "application/json",
                                          "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return str(json.loads(r.read() or b"{}").get("messageId") or "sent")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Brevo {e.code}: {e.read()[:300].decode(errors='replace')}") from None


def send_system(to: list[tuple[str, str]], subject: str, text: str, reference: str = "") -> str:
    """Platform notifications: Brevo if set up, else ZeptoMail, else the sales mailbox (Zoho alone is enough)."""
    if brevo_ready():
        return send_brevo(to, subject, text, tag="system")
    if zepto_ready() or not smtp_ready():
        return send_zepto(to, subject, text, reference)
    return ", ".join(send_outreach(addr, name, subject, text, None, reference) for addr, name in to)


def send_consented(to: str, to_name: str, subject: str, text: str, reply_to: str | None, reference: str) -> str:
    """Email to a prospect who said yes: Brevo if set up, else the sales mailbox."""
    if brevo_ready():
        return send_brevo([(to, to_name)], subject, text, reply_to, tag="sales")
    return send_outreach(to, to_name, subject, text, reply_to, reference)


def _html(text: str) -> str:
    paras = "".join(f"<p style=\"margin:0 0 12px\">{html.escape(p).replace(chr(10), '<br>')}</p>" for p in text.strip().split("\n\n"))
    return f"<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1b1b1f\">{paras}</div>"


def send_zepto(to: list[tuple[str, str]], subject: str, text: str, reference: str = "") -> str:
    """Transactional email through ZeptoMail. Returns ZeptoMail's request id. Raises RuntimeError on failure."""
    if not zepto_ready():
        raise RuntimeError("ZeptoMail is not set up (ZEPTOMAIL_TOKEN and ZEPTOMAIL_FROM on Render).")
    token = os.environ["ZEPTOMAIL_TOKEN"].strip()
    if token.lower().startswith("zoho-enczapikey"):
        token = token.split(None, 1)[1]
    body = {
        "from": {"address": os.environ["ZEPTOMAIL_FROM"], "name": os.environ.get("ZEPTOMAIL_FROM_NAME", "Acolyte")},
        "to": [{"email_address": {"address": a, "name": n or a}} for a, n in to],
        "subject": subject[:250], "textbody": text, "htmlbody": _html(text),
        **({"client_reference": reference[:60]} if reference else {}),
    }
    req = urllib.request.Request(f"https://{os.environ.get('ZEPTOMAIL_HOST', 'api.zeptomail.com')}/v1.1/email",
                                 data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Zoho-enczapikey {token}", "Content-Type": "application/json",
                                          "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read() or b"{}")
            return str(d.get("request_id") or "sent")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ZeptoMail {e.code}: {e.read()[:300].decode(errors='replace')}") from None


def send_outreach(to: str, to_name: str, subject: str, text: str, reply_to: str | None, reference: str,
                  in_reply_to: str | None = None, refs: str | None = None) -> str:
    """One 1:1 email from the sales mailbox over SMTP. Returns the Message-ID. Raises RuntimeError on failure."""
    if not smtp_ready():
        raise RuntimeError("No sales mailbox is set up (OUTREACH_SMTP_* on Render).")
    sender = os.environ.get("OUTREACH_FROM") or os.environ["OUTREACH_SMTP_USER"]
    msg = EmailMessage()
    msg["From"] = formataddr((os.environ.get("OUTREACH_FROM_NAME", "Acolyte"), sender))
    msg["To"] = formataddr((to_name or "", to))
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(idstring=reference, domain=sender.split("@")[-1])
    if in_reply_to:   # a reply: thread it under the email it answers
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = " ".join(x for x in (refs or "", in_reply_to) if x).strip()
    msg.set_content(text)
    msg.add_alternative(_html(text), subtype="html")
    host, port = os.environ["OUTREACH_SMTP_HOST"], int(os.environ.get("OUTREACH_SMTP_PORT", "465"))
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30) as s:
                s.login(os.environ["OUTREACH_SMTP_USER"], os.environ["OUTREACH_SMTP_PASSWORD"]); s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(os.environ["OUTREACH_SMTP_USER"], os.environ["OUTREACH_SMTP_PASSWORD"]); s.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        raise RuntimeError(f"SMTP: {e.__class__.__name__}: {str(e)[:200]}") from None
    return msg["Message-ID"]


# ---------------------------------------------------------------- reading the sales mailbox (IMAP)
import email as _email
import email.header as _eh
import email.utils as _eu
import imaplib
import re
from datetime import datetime as _dt, timedelta as _td


def imap_ready() -> bool:
    return bool(os.environ.get("INBOX_IMAP_HOST") and (os.environ.get("INBOX_USER") or os.environ.get("OUTREACH_SMTP_USER"))
                and (os.environ.get("INBOX_PASSWORD") or os.environ.get("OUTREACH_SMTP_PASSWORD")))


def own_addresses() -> set:
    return {a.lower() for a in (os.environ.get("OUTREACH_FROM"), os.environ.get("OUTREACH_SMTP_USER"), os.environ.get("INBOX_USER")) if a}


def _dec(v) -> str:
    try:
        return str(_eh.make_header(_eh.decode_header(v or "")))
    except Exception:
        return str(v or "")


QUOTE_START = re.compile(r"^(On .{5,200} wrote:|Op .{5,200} geskryf:|-{2,}\s*Original Message\s*-{2,}|_{10,}|From:\s.+|Sent from my \w+.*)$", re.I)


def clean_body(text: str) -> str:
    """The new part of a reply: quoted history and signatures' "Sent from my phone" removed, max 8,000 characters."""
    out = []
    for line in (text or "").replace("\r\n", "\n").split("\n"):
        if QUOTE_START.match(line.strip()):
            break
        if line.lstrip().startswith(">"):
            continue
        out.append(line.rstrip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()[:8000]


def _text_of(msg) -> str:
    if msg.is_multipart():
        plain = html_part = None
        for part in msg.walk():
            if part.get_content_maintype() == "multipart" or part.get("Content-Disposition", "").startswith("attachment"):
                continue
            if part.get_content_type() == "text/plain" and plain is None:
                plain = part
            elif part.get_content_type() == "text/html" and html_part is None:
                html_part = part
        part = plain or html_part
    else:
        part = msg
    if part is None:
        return ""
    raw = part.get_payload(decode=True) or b""
    text = raw.decode(part.get_content_charset() or "utf-8", errors="replace")
    if part.get_content_type() == "text/html":
        text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text)
        text = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", text)
        text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return text


def parse_message(raw: bytes) -> dict:
    msg = _email.message_from_bytes(raw)
    name, addr = _eu.parseaddr(_dec(msg.get("From")))
    try:
        when = _eu.parsedate_to_datetime(msg.get("Date")).isoformat() if msg.get("Date") else None
    except Exception:
        when = None
    return {"message_id": (msg.get("Message-ID") or "").strip() or None, "sent_at": when, "from_email": addr.lower(),
            "from_name": name, "subject": _dec(msg.get("Subject"))[:300], "body": clean_body(_text_of(msg)),
            "in_reply_to": (msg.get("In-Reply-To") or "").strip() or None, "refs": (msg.get("References") or "").strip()[:2000] or None,
            "auto": bool(msg.get("Auto-Submitted", "no").lower() != "no" or msg.get("X-Autoreply") or msg.get("X-Autorespond"))}


def fetch_inbox(days: int = 3, limit: int = 60) -> list[dict]:
    """New mail in the sales mailbox from the last few days, read without marking it as read. Raises RuntimeError."""
    if not imap_ready():
        raise RuntimeError("The sales inbox isn't set up (INBOX_IMAP_HOST on Render, paid mailbox).")
    host, port = os.environ["INBOX_IMAP_HOST"], int(os.environ.get("INBOX_IMAP_PORT", "993"))
    user = os.environ.get("INBOX_USER") or os.environ["OUTREACH_SMTP_USER"]
    password = os.environ.get("INBOX_PASSWORD") or os.environ["OUTREACH_SMTP_PASSWORD"]
    out = []
    try:
        with imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=30) as m:
            m.login(user, password)
            m.select(os.environ.get("INBOX_FOLDER", "INBOX"), readonly=True)   # read-only: nothing is marked or moved
            since = (_dt.now() - _td(days=days)).strftime("%d-%b-%Y")
            typ, data = m.search(None, "SINCE", since)
            ids = (data[0] or b"").split()[-limit:] if typ == "OK" else []
            for i in ids:
                typ, parts = m.fetch(i, "(BODY.PEEK[])")
                raw = next((p[1] for p in parts if isinstance(p, tuple)), None) if typ == "OK" else None
                if raw:
                    out.append(parse_message(raw))
    except (imaplib.IMAP4.error, OSError) as e:
        raise RuntimeError(f"IMAP: {e.__class__.__name__}: {str(e)[:200]}") from None
    return out
