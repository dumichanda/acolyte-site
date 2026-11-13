"""Draft a first email for the best new opportunities. Drafts only: nothing is sent from here.

    python pipeline/draft_outreach.py                # up to DRAFTS_PER_RUN (default 10)
    python pipeline/draft_outreach.py --claude       # let Claude write them (needs ANTHROPIC_API_KEY)

POPIA s69: unsolicited electronic direct marketing needs consent, and you may approach a business
once to ask for it. So the first email is a short, useful note that asks permission to follow up,
says where we found them, and offers an easy opt-out. Opted-out addresses/domains are in `suppression`.

Sender details come from env: SENDER_NAME, SENDER_TITLE, SENDER_EMAIL, SENDER_PHONE.
"""
import argparse
import json
import os

from db import connect, init_db

SENDER = {k: os.environ.get(f"SENDER_{k.upper()}", "") for k in ("name", "title", "email", "phone")}
SITE = "https://dumichanda.github.io/acolyte-site/"


def rands(v) -> str:
    v = float(v or 0)
    return f"R{v / 1e6:.1f}m" if v >= 1e6 else f"R{v / 1e3:.0f}k"


def template(o: dict) -> tuple[str, str]:
    roles = ", ".join(o["titles"][:3])
    tasks = "; ".join(o["tasks"][:3]) or "the repetitive parts of these roles"
    tools = f" (much of it in {', '.join(o['tools'][:3])})" if o["tools"] else ""
    subject = f"Your {o['main_family'].lower()} hiring – a quick idea"
    body = f"""Hi {o['company']} team,

I noticed you are currently hiring for {roles}. Ads like these usually include a lot of routine work – {tasks}{tools}.

At Acolyte we build AI and automation for South African businesses: {o['pitch'][0].lower() + o['pitch'][1:] if o['pitch'] else 'workflow automation and analytics'}. It typically frees up a large share of the time spent on these tasks, so new hires can focus on the work that needs a person.

Would it be OK if I sent you a short, one-page idea of what this could look like for {o['company']}? If you'd rather not hear from us, just reply "no thanks" and we won't contact you again.

Kind regards,
{SENDER['name'] or '[Your name]'}
{SENDER['title'] or 'Acolyte'}
{SENDER['email'] or ''}{(' · ' + SENDER['phone']) if SENDER['phone'] else ''}
{SITE}

We found your vacancy in a public job listing. Acolyte processes business contact details under POPIA – see {SITE}privacy/"""
    return subject, body.strip()


def claude_draft(o: dict) -> tuple[str, str] | None:
    import anthropic
    from pydantic import BaseModel

    class Email(BaseModel):
        subject: str
        body: str

    client = anthropic.Anthropic()
    resp = client.messages.parse(
        model="claude-haiku-5-5",
        max_tokens=1500,
        system=("You write first-contact emails for Acolyte, a South African AI & automation consultancy. "
                "Rules: under 140 words, plain South African business English, no hype, no made-up numbers or claims. "
                "Mention the specific roles they are hiring for and 2-3 concrete tasks we could automate. "
                "POPIA: this is a one-time request for permission – ask if we may send a one-page idea, and include an "
                "opt-out line ('reply \"no thanks\" and we won't contact you again'). Sign off with the sender details given. "
                "End with: 'We found your vacancy in a public job listing.'"),
        messages=[{"role": "user", "content": json.dumps({**o, "sender": SENDER, "site": SITE}, default=str)}],
        output_format=Email,
    )
    return (resp.parsed_output.subject, resp.parsed_output.body) if resp.parsed_output else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=int(os.environ.get("DRAFTS_PER_RUN", "10")))
    ap.add_argument("--claude", action="store_true")
    args = ap.parse_args()
    use_claude = args.claude and os.environ.get("ANTHROPIC_API_KEY")
    init_db()
    with connect() as conn:
        cur = conn.execute(
            """SELECT o.id AS opp_id, c.id AS company_id, c.name AS company, l.main_family, o.pitch, o.est_value,
                      k.id AS contact_id, k.email,
                      (SELECT array_agg(DISTINCT j.title) FROM v_jobs j WHERE j.company_id = c.id AND j.role_family = l.main_family) AS titles,
                      (SELECT array_agg(DISTINCT t) FROM jobs j JOIN job_insights i ON i.job_id = j.id,
                              unnest(i.tools) t WHERE j.company_id = c.id) AS tools,
                      (SELECT array_agg(DISTINCT t) FROM v_jobs j, unnest(j.automatable_tasks) t
                        WHERE j.company_id = c.id AND j.role_family = l.main_family) AS tasks
               FROM opportunities o
               JOIN companies c ON c.id = o.company_id
               JOIN v_company_leads l ON l.id = c.id
               JOIN LATERAL (SELECT * FROM contacts k WHERE k.company_id = c.id AND k.email IS NOT NULL
                               AND k.consent_status = 'unknown' ORDER BY k.is_generic, k.id LIMIT 1) k ON TRUE
               WHERE o.stage = 'new'
                 AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.opportunity_id = o.id AND a.kind = 'email_draft')
                 AND NOT EXISTS (SELECT 1 FROM suppression s
                                 WHERE s.value = lower(k.email) OR s.value = split_part(lower(k.email), '@', 2))
               ORDER BY o.est_value DESC NULLS LAST LIMIT %s""", (args.limit,))
        cols = [d.name for d in cur.description]
        todo = [dict(zip(cols, r)) for r in cur.fetchall()]
        for o in todo:
            o["titles"], o["tools"], o["tasks"] = o["titles"] or [], o["tools"] or [], o["tasks"] or []
            drafted, how = None, "template"
            if use_claude:
                try:
                    drafted, how = claude_draft(o), "claude-haiku-5-5"
                except Exception as e:  # any API problem: fall back to the template
                    print(f"  Claude draft failed for {o['company']} ({e.__class__.__name__}); using template.")
            subject, body = drafted or template(o)
            conn.execute(
                """INSERT INTO activities (opportunity_id, company_id, contact_id, kind, subject, body, meta)
                   VALUES (%s, %s, %s, 'email_draft', %s, %s, %s)""",
                (o["opp_id"], o["company_id"], o["contact_id"], subject, body,
                 json.dumps({"to": o["email"], "written_by": how if drafted else "template"})),
            )
            conn.execute("UPDATE opportunities SET next_action = 'Review and send first email', updated_at = now() "
                         "WHERE id = %s", (o["opp_id"],))
            conn.commit()
            print(f"  Draft for {o['company']} -> {o['email']}")
    print(f"Drafted {len(todo)} emails (review them in the CRM before sending).")


if __name__ == "__main__":
    main()
