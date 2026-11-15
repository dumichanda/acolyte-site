"""Email for the platform.

Three routes, because the rules differ:
- System mail (lead assignments, agents' daily tasks, owner alerts): Brevo (recommended) or ZeptoMail, over HTTPS.
- Mail to prospects who said yes (the monthly pack, follow-ups): Brevo, which allows email to people who opted in;
  otherwise the sales mailbox. ZeptoMail is never used for this: its terms allow transactional email only.
- The single permission email (POPIA s69: one unsolicited approach) is a 1:1 email from a real sales mailbox over
  SMTP (e.g. Zoho Mail: smtp.zoho.com:465), at a low daily rate with the agent as reply-to. No email provider allows
  cold email to people who never opted in. Without a mailbox, the agent sends it from their own mail app.

Settings (Render environment variables; secrets never in code):
  BREVO_API_KEY        Brevo > SMTP & API > API keys
  BREVO_FROM           a verified sender on your domain, e.g. hello@acolyte.co.za
  ZEPTOMAIL_TOKEN      "Send Mail" token from ZeptoMail > Mail Agents > SMTP/API (the part after "Zoho-enczapikey")
  ZEPTOMAIL_FROM       a verified sender on your domain, e.g. noreply@acolyte.co.za
  ZEPTOMAIL_HOST       api.zeptomail.com (default) or your data centre, e.g. api.zeptomail.eu, api.zeptomail.in
  OUTREACH_SMTP_HOST / OUTREACH_SMTP_PORT / OUTREACH_SMTP_USER / OUTREACH_SMTP_PASSWORD / OUTREACH_FROM
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
    return brevo_ready() or zepto_ready()


def status() -> dict:
    return {"system": "brevo" if brevo_ready() else "zeptomail" if zepto_ready() else None,
            "consented": "brevo" if brevo_ready() else "smtp" if smtp_ready() else None,
            "permission": "smtp" if smtp_ready() else "manual",
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
    """Platform notifications: Brevo if set up, else ZeptoMail."""
    if brevo_ready():
        return send_brevo(to, subject, text, tag="system")
    return send_zepto(to, subject, text, reference)


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


def send_outreach(to: str, to_name: str, subject: str, text: str, reply_to: str | None, reference: str) -> str:
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
