import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./crm.css";
import PlatformNav from "../PlatformNav";
import { rands } from "../types";

// The CRM talks to crm/server.py running on the user's own computer; nothing private is on the public site.
const API = (() => {
  try { const o = localStorage.getItem("crmApi"); if (o) return o; } catch { /* storage blocked */ }
  return location.port === "8787" ? "" : "http://127.0.0.1:8787";
})();

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data as T;
}

const STAGE_LABEL: Record<string, string> = {
  new: "New", researching: "Researching", contacted: "Contacted", replied: "Replied", meeting: "Meeting",
  proposal: "Proposal", won: "Won", lost: "Lost", not_a_fit: "Not a fit",
};
const BOARD = ["new", "researching", "contacted", "replied", "meeting", "proposal", "won"];
const CONSENT_LABEL: Record<string, string> = {
  unknown: "Not asked yet", requested: "Permission asked", granted: "Happy to hear more", declined: "Declined", opted_out: "Opted out",
};

interface Opp {
  id: number; stage: string; est_value: number | null; pitch: string | null; next_action: string | null; next_action_at: string | null;
  company_id: number; name: string; website: string | null; industry: string | null; hq_city: string | null; hq_province: string | null;
  open_roles: number | null; avg_score: number | null; main_family: string | null; contacts: number; emails: number; drafts: number; last_touch: string | null;
}
interface Contact { id: number; name: string | null; role: string | null; email: string | null; phone: string | null; linkedin_url: string | null; is_generic: boolean; source: string | null; consent_status: string; suppressed: boolean; notes: string | null }
interface Activity { id: number; kind: string; subject: string | null; body: string | null; contact_id: number | null; meta: any; created_at: string }
interface Detail extends Opp {
  size_band: string | null; linkedin_url: string | null; description: string | null; automatable_value: number | null;
  contacts_list?: never; contacts: any; activities: Activity[];
  roles: { title: string; url: string | null; city: string | null; posted: string | null; score: number; value: number; family: string; tools: string[] | null; skills: string[] | null }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const when = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Setup({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="card setup">
      <span className="tag">Private</span>
      <h2 style={{ fontSize: 22, margin: "10px 0 6px" }}>Connect your CRM</h2>
      <p className="muted">The CRM holds contact details, so it is never published on the website. It runs from a small server on your own computer that connects to your Neon database. This page then reads and writes through it.</p>
      <ol>
        <li>Install Python 3.12+ and Git, then get the code:
          <pre>git clone https://github.com/dumichanda/acolyte-site.git{"\n"}cd acolyte-site{"\n"}pip install -r requirements.txt</pre></li>
        <li>Create a file called <code>.env</code> in that folder with your Neon connection string (the same value as the <code>DATABASE_URL</code> GitHub secret):
          <pre>DATABASE_URL=postgresql://…neon.tech/neondb?sslmode=require</pre></li>
        <li>Start the CRM server and leave it running:
          <pre>python crm/server.py</pre></li>
        <li><button className="btn primary" onClick={retry}>Connect</button></li>
      </ol>
      <p className="muted" style={{ fontSize: 12 }}>Tried {API || location.origin}: {error}. Use Chrome or Edge. Some browsers block a public page from talking to your own computer.</p>
    </div>
  );
}

function Card({ o, onOpen }: { o: Opp; onOpen: () => void }) {
  const due = o.next_action_at && o.next_action_at <= today() && !["won", "lost", "not_a_fit"].includes(o.stage);
  return (
    <button className={"ocard" + (due ? " due" : "")} onClick={onOpen}>
      <div className="oname">{o.name}</div>
      <div className="ometa">{o.main_family ?? "—"} · {o.open_roles ?? 0} roles</div>
      <div className="orow">
        <b>{o.est_value ? rands(o.est_value) : "—"}</b>
        <span>
          {o.drafts > 0 && <span className="pill lime" title="Draft email ready">draft</span>}
          {o.emails === 0 && <span className="pill" title="No email address yet">no email</span>}
        </span>
      </div>
      {o.next_action && <div className="onext">{due ? "Due: " : ""}{o.next_action}</div>}
    </button>
  );
}

function DraftBox({ d, contacts, oppId, onDone }: { d: Activity; contacts: Contact[]; oppId: number; onDone: (x: Detail) => void }) {
  const usable = contacts.filter((c) => c.email && !c.suppressed && !["declined", "opted_out"].includes(c.consent_status));
  const [subject, setSubject] = useState(d.subject ?? "");
  const [body, setBody] = useState(d.body ?? "");
  const [to, setTo] = useState<number | "">(d.contact_id ?? usable[0]?.id ?? "");
  const [msg, setMsg] = useState("");
  const email = contacts.find((c) => c.id === to)?.email ?? "";
  const save = () => api(`/api/activity/${d.id}`, { subject, body }).then(() => setMsg("Saved"));
  const sent = async () => {
    try { onDone(await api(`/api/opportunity/${oppId}/sent`, { contact_id: to, subject, body, draft_id: d.id })); }
    catch (e) { setMsg(String((e as Error).message)); }
  };
  return (
    <div className="draft">
      <div className="field"><label>To</label>
        <select value={to} onChange={(e) => setTo(Number(e.target.value) || "")}>
          <option value="">Choose a contact…</option>
          {usable.map((c) => <option key={c.id} value={c.id}>{c.name ? `${c.name} – ` : ""}{c.email}</option>)}
        </select>
      </div>
      <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="field"><label>Message</label><textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div className="actions">
        <a className={"btn" + (email ? "" : " disabled")} href={email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : undefined}>Open in my email app</a>
        <button className="btn" onClick={() => navigator.clipboard.writeText(body).then(() => setMsg("Copied"))}>Copy text</button>
        <button className="btn" onClick={save}>Save draft</button>
        <button className="btn primary" disabled={!to} onClick={sent}>I've sent it</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <p className="muted small">Send it from your own mailbox, then click <b>I've sent it</b>. That logs it, marks the contact as "permission asked" and sets a one-time follow-up in 7 days. POPIA allows one request for permission. Don't keep emailing someone who hasn't replied.</p>
    </div>
  );
}

function Panel({ id, close, changed }: { id: number; close: () => void; changed: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState({ contact_id: 0, outcome: "granted", body: "" });
  const [nc, setNc] = useState({ name: "", role: "", email: "", phone: "", linkedin_url: "", source: "" });
  const load = useCallback(() => api<Detail>(`/api/opportunity/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const apply = (x: Detail) => { setD(x); changed(); };
  const run = (p: Promise<any>) => p.then(() => { load(); changed(); }).catch((e) => setErr(e.message));
  if (!d) return <aside className="panel"><button className="x" onClick={close}>✕</button>{err || "Loading…"}</aside>;
  const contacts: Contact[] = d.contacts;
  const draft = d.activities.find((a) => a.kind === "email_draft");
  const history = d.activities.filter((a) => a.kind !== "email_draft");

  return (
    <aside className="panel">
      <button className="x" onClick={close} aria-label="Close">✕</button>
      <h2>{d.name}</h2>
      <div className="muted">
        {[d.industry, d.size_band && `${d.size_band} staff`, [d.hq_city, d.hq_province].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
      </div>
      <div style={{ margin: "6px 0 12px" }}>
        {d.website && <a href={`https://${d.website}`} target="_blank" rel="noreferrer">{d.website}</a>}
        {d.linkedin_url && <> · <a href={d.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></>}
      </div>
      {err && <div className="banner">{err}</div>}

      <div className="pgrid">
        <div className="field"><label>Stage</label>
          <select value={d.stage} onChange={(e) => api<Detail>(`/api/opportunity/${id}`, { stage: e.target.value }).then(apply)}>
            {Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div className="field"><label>Next action</label>
          <input key={`na-${d.next_action ?? ""}`} defaultValue={d.next_action ?? ""} onBlur={(e) => api<Detail>(`/api/opportunity/${id}`, { next_action: e.target.value }).then(apply)} /></div>
        <div className="field"><label>Due</label>
          <input key={`nd-${d.next_action_at ?? ""}`} type="date" defaultValue={d.next_action_at ?? ""} onChange={(e) => api<Detail>(`/api/opportunity/${id}`, { next_action_at: e.target.value }).then(apply)} /></div>
      </div>

      <div className="kv">
        <div><span>Automatable work / yr</span><b>{d.automatable_value ? rands(d.automatable_value) : "—"}</b></div>
        <div><span>Open roles</span><b>{d.open_roles ?? 0}</b></div>
        <div><span>Avg score</span><b>{d.avg_score ?? "—"}</b></div>
      </div>
      {d.pitch && <p><b>Pitch:</b> {d.pitch}</p>}
      {d.description && <p className="muted">{d.description}</p>}

      {draft && <section><h3>First email (draft)</h3><DraftBox key={draft.id} d={draft} contacts={contacts} oppId={id} onDone={apply} /></section>}

      <section>
        <h3>Contacts</h3>
        {contacts.length === 0 && <p className="muted">No contacts yet. Add the company's published inbox, or a person who agreed to be contacted.</p>}
        {contacts.map((c) => (
          <div className="contact" key={c.id}>
            <div>
              <b>{c.name || c.role || "General inbox"}</b>{c.name && c.role && <span className="muted"> · {c.role}</span>}
              <div className="muted small">{[c.email, c.phone].filter(Boolean).join(" · ")}{c.source && <> · <a href={c.source} target="_blank" rel="noreferrer">source</a></>}</div>
            </div>
            <select className={"consent " + c.consent_status} value={c.consent_status}
              onChange={(e) => run(api(`/api/contact/${c.id}`, { consent_status: e.target.value }))}>
              {Object.entries(CONSENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        ))}
        <details className="add">
          <summary>Add contact</summary>
          <div className="pgrid">
            {(["name", "role", "email", "phone", "linkedin_url", "source"] as const).map((k) => (
              <div className="field" key={k}><label>{k === "linkedin_url" ? "LinkedIn URL" : k === "source" ? "Where you found it" : k[0].toUpperCase() + k.slice(1)}</label>
                <input value={nc[k]} onChange={(e) => setNc({ ...nc, [k]: e.target.value })} /></div>
            ))}
          </div>
          <button className="btn" onClick={() => run(api("/api/contact", { ...nc, company_id: d.company_id })).then(() => setNc({ name: "", role: "", email: "", phone: "", linkedin_url: "", source: "" }))}>Save contact</button>
        </details>
      </section>

      <section>
        <h3>Log a reply</h3>
        <div className="pgrid">
          <div className="field"><label>From</label>
            <select value={reply.contact_id} onChange={(e) => setReply({ ...reply, contact_id: Number(e.target.value) })}>
              <option value={0}>Choose…</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name || c.email || c.phone}</option>)}
            </select></div>
          <div className="field"><label>Outcome</label>
            <select value={reply.outcome} onChange={(e) => setReply({ ...reply, outcome: e.target.value })}>
              <option value="granted">Interested / happy to hear more</option><option value="other">Question or other</option>
              <option value="declined">Not interested</option><option value="opted_out">Asked not to be contacted</option>
            </select></div>
        </div>
        <div className="field"><textarea rows={3} placeholder="Paste or summarise their reply" value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} /></div>
        <button className="btn" disabled={!reply.contact_id} onClick={() => api<Detail>(`/api/opportunity/${id}/reply`, reply).then((x) => { apply(x); setReply({ contact_id: 0, outcome: "granted", body: "" }); }).catch((e) => setErr(e.message))}>Log reply</button>
        <p className="muted small">"Not interested" and "asked not to be contacted" add the address to the do-not-contact list automatically.</p>
      </section>

      <section>
        <h3>Notes & history</h3>
        <div className="field"><textarea rows={2} placeholder="Add a note, call summary or meeting notes" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn" disabled={!note.trim()} onClick={() => run(api(`/api/opportunity/${id}/activity`, { kind: "note", body: note })).then(() => setNote(""))}>Add note</button>
        <ul className="timeline">
          {history.map((a) => (
            <li key={a.id} className={a.kind}>
              <span className="when">{when(a.created_at)}</span>
              <b>{{ email_sent: "Email sent", reply: "Reply", note: "Note", stage: "Stage", call: "Call", meeting: "Meeting" }[a.kind] ?? a.kind}</b>
              {a.subject && <> · {a.subject}</>}
              {a.body && <div className="body">{a.body}</div>}
            </li>
          ))}
          {!history.length && <li className="muted">Nothing yet.</li>}
        </ul>
      </section>

      <section>
        <h3>Their open roles</h3>
        <table><tbody>
          {d.roles.map((r, i) => (
            <tr key={i}>
              <td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}
                <div className="muted small">{r.family}{r.tools?.length ? ` · ${r.tools.join(", ")}` : ""}</div></td>
              <td className="num">{r.score}</td><td className="num">{rands(r.value)}</td>
            </tr>
          ))}
        </tbody></table>
      </section>
    </aside>
  );
}

function App() {
  const [data, setData] = useState<{ stages: string[]; opportunities: Opp[]; stats: any } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "drafts" | "due" | "noemail">("");
  const load = useCallback(() => api("/api/pipeline").then((x) => { setData(x); setErr(""); }).catch((e) => setErr(e.message || "not reachable")), []);
  useEffect(() => { load(); }, [load]);

  const opps = useMemo(() => (data?.opportunities ?? [])
    .filter((o) => !q || `${o.name} ${o.industry ?? ""} ${o.main_family ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .filter((o) => only !== "drafts" || o.drafts > 0)
    .filter((o) => only !== "due" || (o.next_action_at && o.next_action_at <= today()))
    .filter((o) => only !== "noemail" || o.emails === 0), [data, q, only]);
  const closed = opps.filter((o) => o.stage === "lost" || o.stage === "not_a_fit");

  return (
    <div className="wrap crm">
      <PlatformNav active="/crm/" />
      <header className="top">
        <div>
          <h1>Sales pipeline</h1>
          <p className="sub">Every hiring employer becomes an opportunity. Research it, send one permission-based email, track the reply.</p>
        </div>
        {data && <button className="btn" onClick={load}>Refresh</button>}
      </header>
      {!data && !err && <div className="muted">Connecting…</div>}
      {!data && err && <Setup error={err} retry={load} />}
      {data && (
        <>
          <section className="kpis">
            <div className="kpi"><div className="label">Opportunities</div><div className="value">{data.stats.opportunities}</div><div className="hint">hiring employers</div></div>
            <div className="kpi"><div className="label">Emails sent</div><div className="value">{data.stats.sent}</div><div className="hint">{data.stats.replies} replies</div></div>
            <div className="kpi"><div className="label">Meetings / proposals</div><div className="value">{data.stats.meetings}</div><div className="hint">in progress</div></div>
            <div className="kpi"><div className="label">Won</div><div className="value">{data.stats.won}</div><div className="hint">clients</div></div>
            <div className="kpi"><div className="label">Due today</div><div className="value">{data.stats.due}</div><div className="hint">follow-ups and next actions</div></div>
          </section>
          <div className="toolbar">
            <input placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} />
            {([["", "All"], ["drafts", "Draft ready"], ["due", "Due"], ["noemail", "Needs a contact"]] as const).map(([k, l]) => (
              <button key={k} className={"btn" + (only === k ? " primary" : "")} onClick={() => setOnly(k)}>{l}</button>
            ))}
          </div>
          <div className="board">
            {BOARD.map((st) => {
              const col = opps.filter((o) => o.stage === st);
              return (
                <div className="col" key={st}>
                  <div className="colh">{STAGE_LABEL[st]} <span>{col.length}</span></div>
                  {col.slice(0, 60).map((o) => <Card key={o.id} o={o} onOpen={() => setOpen(o.id)} />)}
                  {col.length > 60 && <div className="muted small">+{col.length - 60} more (use search)</div>}
                </div>
              );
            })}
          </div>
          {closed.length > 0 && (
            <details className="closed"><summary>Closed ({closed.length})</summary>
              {closed.map((o) => <Card key={o.id} o={o} onOpen={() => setOpen(o.id)} />)}
            </details>
          )}
        </>
      )}
      {open !== null && <><div className="scrim" onClick={() => setOpen(null)} /><Panel id={open} close={() => setOpen(null)} changed={load} /></>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
