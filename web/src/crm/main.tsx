import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./crm.css";
import PlatformNav from "../PlatformNav";
import { API } from "../auth";

/**
 * Acolyte's own sales CRM. Prospects for each industry analyst are ranked from our datasets
 * (agencies from property listings, retailers and online stores from prices, employers and recruiters from job ads).
 * The owner signs in with the admin key; account agents sign in with their own PIN and see only their leads.
 * The funnel (hourly) assigns leads, drafts emails into the Outbox, sends approved ones and emails agents their tasks.
 */
const KEY_STORE = "acolyteAdminKey", AGENT_STORE = "acolyteAgentToken";
type Analyst = "property" | "retail" | "marketplace" | "jobs";
const ANALYSTS: { key: Analyst; label: string; who: string }[] = [
  { key: "property", label: "Property Analyst", who: "estate agencies" },
  { key: "retail", label: "Retail Pricing Analyst", who: "retailers" },
  { key: "marketplace", label: "Marketplace Analyst", who: "online stores" },
  { key: "jobs", label: "Talent Analyst", who: "employers and recruiters" },
];
const STAGES = ["prospect", "researching", "contacted", "meeting", "proposal", "won", "lost"] as const;
type Stage = typeof STAGES[number];
const STAGE_LABEL: Record<Stage, string> = { prospect: "To approach", researching: "Researching", contacted: "Contacted",
  meeting: "Meeting", proposal: "Proposal", won: "Won", lost: "Lost" };

interface Prospect {
  id: number; analyst: Analyst; name: string; segment: string | null; score: number; rank: number | null;
  reasons: string[]; metrics: Record<string, unknown>; pitch: string | null; stage: Stage; pinned: boolean;
  website: string | null; contact_name: string | null; contact_role: string | null; contact_email: string | null;
  next_step: string | null; next_date: string | null; value_zar: number | null; notes: string | null;
  scored_at: string | null; updated_at: string; suppressed?: boolean;
  agent_id: number | null; agent_name?: string | null; consent: Consent;
}
type Consent = "unknown" | "requested" | "granted" | "declined" | "no_response" | "opted_out";
const CONSENT_LABEL: Record<Consent, string> = { unknown: "Not asked yet", requested: "Permission asked", granted: "Said yes",
  declined: "Said no", no_response: "No reply", opted_out: "Opted out" };
interface Me { admin: boolean; agent_id: number | null; name: string; mail?: MailStatus | null }
interface MailStatus { system: string | null; consented: string | null; permission: string; brevo_from: string; zeptomail_from: string; outreach_from: string }
interface Agent { id: number; name: string; email: string; analysts: Analyst[]; max_open: number; active: boolean; last_login: string | null;
  open_leads: number; won: number; won_zar: number }
interface Email { id: number; prospect_id: number; prospect: string; analyst: Analyst; kind: "permission" | "pack" | "followup"; step: number;
  to_email: string; subject: string; body: string; status: string; due_at: string; sent_at: string | null; transport: string | null;
  error: string | null; agent_name: string | null; contact_name: string | null; consent: Consent }
interface Activity { id: number; at: string; kind: string; text: string }
interface BoardData { ranked: Prospect[]; board: Prospect[]; totals: { stage: Stage; n: number; value_zar: number }[];
  counts: { analyst: Analyst; n: number; scored_at: string }[] }

const R = (n: number | null | undefined) => "R" + Math.round(Number(n || 0)).toLocaleString("en-ZA");
const when = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ALABEL = Object.fromEntries(ANALYSTS.map((a) => [a.key, a.label])) as Record<Analyst, string>;

function useAdmin(key: string, onBadKey: () => void) {
  return useCallback(async <T = any,>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const r = await fetch(API + path, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { onBadKey(); throw new Error("Your sign-in has expired. Please sign in again."); }
    if (!r.ok) throw new Error(d.detail || r.statusText);
    return d as T;
  }, [key, onBadKey]);
}

function KeyGate({ onKey, onAgent, error }: { onKey: (k: string) => void; onAgent: (t: string) => void; error: string }) {
  const [k, setK] = useState(""), [mode, setMode] = useState<"agent" | "owner">("agent"), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const submit = async () => {
    if (!k.trim()) return;
    if (mode === "owner") { onKey(k.trim()); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(API + "/sales/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: k.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || "Sign-in failed.");
      onAgent(d.token);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card crm-gate" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="tag">Private</span>
      <h2>Sign in to the sales CRM</h2>
      <div className="seg" role="group" aria-label="Who is signing in">
        <button type="button" aria-pressed={mode === "agent"} onClick={() => setMode("agent")}>Account agent</button>
        <button type="button" aria-pressed={mode === "owner"} onClick={() => setMode("owner")}>Owner</button>
      </div>
      <p className="muted">{mode === "agent" ? "Use the PIN the owner gave you. You'll see the leads assigned to you." : "Use the same admin key as the admin page."}</p>
      <div className="row"><input id="crm-key" type="password" inputMode={mode === "agent" ? "numeric" : undefined} value={k} onChange={(e) => setK(e.target.value)}
        placeholder={mode === "agent" ? "Your PIN" : "Admin key"} autoComplete="current-password" />
        <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Open CRM"}</button></div>
      {(err || error) && <div className="banner">{err || error}</div>}
    </form>
  );
}

function Score({ v }: { v: number }) {
  return <span className="score" title={`Fit score ${Math.round(v)} / 100`}><i style={{ width: `${Math.max(4, Math.min(100, v))}%` }} /><b>{Math.round(v)}</b></span>;
}

function Detail({ id, call, me, agents, onClose, onChanged }: { id: number; call: ReturnType<typeof useAdmin>; me: Me; agents: Agent[];
                   onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<Prospect | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [form, setForm] = useState<Partial<Prospect>>({});
  const [note, setNote] = useState(""), [draft, setDraft] = useState(""), [busy, setBusy] = useState(""), [err, setErr] = useState(""), [saved, setSaved] = useState("");
  const load = useCallback(async () => {
    const d = await call<{ prospect: Prospect; activities: Activity[] }>(`/admin/sales/${id}`);
    setP(d.prospect); setActs(d.activities); setForm({});
  }, [call, id]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);
  const run = async (k: string, f: () => Promise<void>) => { setBusy(k); setErr(""); setSaved(""); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); } };
  if (!p) return <aside className="drawer"><button className="link close" onClick={onClose}>Close</button><p className="muted">{err || "Loading…"}</p></aside>;
  const v = (k: keyof Prospect) => (form[k] ?? p[k] ?? "") as string;
  const set = (k: keyof Prospect) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = (patch: Partial<Prospect>) => run("save", async () => {
    await call(`/admin/sales/${p.id}`, "PATCH", patch); await load(); onChanged(); setSaved("Saved");
  });
  const metrics = Object.entries(p.metrics || {}).filter(([k, x]) => x !== null && x !== "" && k !== "name");
  return (
    <aside className="drawer" aria-label={`Prospect ${p.name}`}>
      <div className="drawer-head">
        <div><span className="tag">{ALABEL[p.analyst]}</span><h2>{p.name}</h2>
          <div className="muted small">{p.segment}{p.rank ? ` · ranked #${p.rank}` : " · not in today's data"} · fit {Math.round(p.score)}/100</div></div>
        <button className="link close" onClick={onClose} aria-label="Close">Close</button>
      </div>
      {p.suppressed && <div className="banner">This business or address asked not to be contacted. Drafting is blocked.</div>}
      <section><h3>Why approach them</h3><ul className="reasons">{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {p.pitch && <p className="pitch"><b>Lead with:</b> {p.pitch}</p>}</section>
      <section className="grid2">
        <label>Assigned to{me.admin ? <select id="d-agent" value={p.agent_id ?? ""} onChange={(e) => save(e.target.value ? { agent_id: Number(e.target.value) } as Partial<Prospect>
            : { unassign: true } as unknown as Partial<Prospect>)}>
            <option value="">Not assigned</option>{agents.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          : <input value={p.agent_name || "You"} readOnly />}</label>
        <label>Permission to email<select id="d-consent" value={p.consent} onChange={(e) => save({ consent: e.target.value as Consent })}>
          {(Object.keys(CONSENT_LABEL) as Consent[]).map((c) => <option key={c} value={c}>{CONSENT_LABEL[c]}</option>)}</select></label>
        <label>Stage<select id="d-stage" value={v("stage")} onChange={(e) => save({ stage: e.target.value as Stage })}>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></label>
        <label>Expected value / month<input id="d-value" type="number" min="0" step="1000" value={v("value_zar")} onChange={set("value_zar")} /></label>
        <label>Website<input id="d-web" value={v("website")} onChange={set("website")} placeholder="https://…" /></label>
        <label>Next step<input id="d-next" value={v("next_step")} onChange={set("next_step")} placeholder="e.g. Call the principal" /></label>
        <label>Next date<input id="d-date" type="date" value={(v("next_date") || "").slice(0, 10)} onChange={set("next_date")} /></label>
        <label>Contact name<input id="d-cname" value={v("contact_name")} onChange={set("contact_name")} /></label>
        <label>Contact role<input id="d-crole" value={v("contact_role")} onChange={set("contact_role")} placeholder="e.g. Principal, Head of Pricing" /></label>
        <label>Business email<input id="d-cemail" type="email" value={v("contact_email")} onChange={set("contact_email")} /></label>
        <label className="wide">Notes<textarea id="d-notes" rows={3} value={v("notes")} onChange={set("notes")} /></label>
      </section>
      <div className="row">
        <button className="btn primary" disabled={!!busy || !Object.keys(form).length} onClick={() => save({ ...form, value_zar: form.value_zar !== undefined ? Number(form.value_zar) : undefined })}>{busy === "save" ? "Saving…" : "Save"}</button>
        {!p.pinned && <button className="btn" disabled={!!busy} onClick={() => save({ pinned: true })}>Add to board</button>}
        {saved && <span className="muted small">{saved}</span>}
      </div>
      <section>
        <h3>Emails</h3>
        <p className="muted small">Add a business email above and the funnel drafts the permission email into the Outbox within the hour (POPIA allows one unsolicited email; anything more only after they say yes). For a one-off email, draft one here and copy it.</p>
        <div className="row"><button className="btn" disabled={!!busy || p.suppressed} onClick={() => run("draft", async () => {
          const d = await call<{ draft: string; activities: Activity[] }>(`/admin/sales/${p.id}/draft`, "POST"); setDraft(d.draft); setActs(d.activities);
        })}>{busy === "draft" ? "Drafting…" : "Draft with AI"}</button>
          {draft && <button className="btn" onClick={() => navigator.clipboard?.writeText(draft).then(() => setSaved("Copied"), () => setSaved("Select the text to copy"))}>Copy</button>}</div>
        {draft && <pre className="draft">{draft}</pre>}
      </section>
      <section>
        <h3>Activity</h3>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!note.trim()) return; run("note", async () => {
          const d = await call<{ activities: Activity[] }>(`/admin/sales/${p.id}/activities`, "POST", { kind: "note", text: note }); setActs(d.activities); setNote("");
        }); }}>
          <input id="d-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a call, email or note" />
          <button className="btn" disabled={!!busy || !note.trim()}>Add</button>
        </form>
        <ol className="acts">{acts.map((a) => <li key={a.id}><span className="muted small">{when(a.at)} · {a.kind.replace("_", " ")}</span>
          {a.kind === "email_draft" ? <details><summary>Email draft</summary><pre className="draft">{a.text}</pre></details> : <p>{a.text}</p>}</li>)}</ol>
      </section>
      {metrics.length > 0 && <section><h3>Data behind the score</h3><dl className="metrics">{metrics.map(([k, x]) => <div key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{String(x)}</dd></div>)}</dl></section>}
      <section className="danger">
        <button className="link" disabled={!!busy} onClick={() => run("sup", async () => {
          await call("/admin/sales/suppress", "POST", { value: p.contact_email || p.name }); await save({ stage: "lost" });
        })}>Do not contact (opted out)</button>
      </section>
      {err && <div className="banner">{err}</div>}
    </aside>
  );
}

function mailto(e: Email) {
  return `mailto:${encodeURIComponent(e.to_email)}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`;
}
const KIND_LABEL = { permission: "Permission email", pack: "Monthly pack", followup: "Follow-up" };

interface Enquiry { id: number; at: string; first_name: string; last_name: string; email: string; phone: string; job_role: string; company: string;
  company_type: string; industry: string; province: string; analyst: string; nature: string; message: string | null; marketing: boolean; prospect_id: number | null }
const NATURE_NAME: Record<string, string> = { sales: "Sales", support: "Support", billing: "Billing / account", privacy: "Data & privacy" };

/** Website Contact sales submissions (owner only). Sales enquiries about one analyst are already pinned prospects. */
function Enquiries({ call, onOpen }: { call: ReturnType<typeof useAdmin>; onOpen: (pid: number) => void }) {
  const [list, setList] = useState<Enquiry[] | null>(null), [err, setErr] = useState("");
  useEffect(() => { call<{ enquiries: Enquiry[] }>("/admin/sales-enquiries").then((d) => setList(d.enquiries)).catch((e) => setErr(e.message)); }, [call]);
  if (err) return <div className="banner">{err}</div>;
  if (!list) return <p className="muted small">Loading…</p>;
  if (!list.length) return <p className="muted small">No website enquiries yet. They arrive from the Contact sales form at acolytegroup.co.za/contact/.</p>;
  return (
    <div className="outbox">{list.map((e) => (
      <article key={e.id} className="mail">
        <header><b>{e.first_name} {e.last_name}</b> · {e.job_role} at {e.company} <span className="muted small">· E{e.id} · {when(e.at)}</span></header>
        <p className="small">{e.company_type} · {e.industry} · {e.province} · about <b>{ANALYSTS.find((a) => a.key === e.analyst)?.label || e.analyst.replace("_", " ")}</b> · {NATURE_NAME[e.nature] || e.nature}
          {e.marketing ? " · said yes to the monthly report" : ""}</p>
        <p className="small"><a href={`mailto:${e.email}`}>{e.email}</a> · <a href={`tel:${e.phone.replace(/\s/g, "")}`}>{e.phone}</a></p>
        {e.message && <p style={{ whiteSpace: "pre-wrap" }}>{e.message}</p>}
        {e.prospect_id && <button className="btn sm" onClick={() => onOpen(e.prospect_id!)}>Open the deal</button>}
      </article>))}
    </div>
  );
}

function Outbox({ call, me, onOpen }: { call: ReturnType<typeof useAdmin>; me: Me; onOpen: (pid: number) => void }) {
  const [list, setList] = useState<Email[] | null>(null), [mailSt, setMail] = useState<MailStatus | null>(null);
  const [edit, setEdit] = useState<Record<number, { subject: string; body: string }>>({}), [err, setErr] = useState(""), [busy, setBusy] = useState(0);
  const load = useCallback(() => call<{ emails: Email[]; mail: MailStatus }>("/admin/sales-outbox").then((d) => { setList(d.emails); setMail(d.mail); })
    .catch((e) => setErr(e.message)), [call]);
  useEffect(() => { load(); }, [load]);
  const act = async (e: Email, action: string, extra: object = {}) => {
    setBusy(e.id); setErr("");
    try { await call(`/admin/sales-outbox/${e.id}`, "POST", { action, ...extra }); setEdit((m) => { const n = { ...m }; delete n[e.id]; return n; }); await load(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(0); }
  };
  const manual = (e: Email) => e.kind === "permission" ? mailSt?.permission === "manual" : !mailSt?.consented;
  if (!list) return <p className="muted">{err || "Loading the outbox…"}</p>;
  const groups: [string, Email[]][] = [["Waiting for approval", list.filter((e) => e.status === "draft" || e.status === "failed")],
    ["Approved, going out", list.filter((e) => e.status === "approved")], ["Sent in the last 14 days", list.filter((e) => ["sent", "manual"].includes(e.status))]];
  return (
    <div className="outbox">
      {mailSt && <p className="muted small">Permission emails go {mailSt.permission === "smtp" ? `from ${mailSt.outreach_from}` : "from your own mail app (no sales mailbox set up yet)"};
        emails to people who said yes go {mailSt.consented ? `through ${mailSt.consented === "brevo" ? "Brevo" : "the sales mailbox"}` : "from your own mail app"}.</p>}
      {err && <div className="banner">{err}</div>}
      {groups.map(([title, items]) => (
        <section key={title}><h3>{title} <em>{items.length}</em></h3>
          {!items.length && <p className="muted small">Nothing here.</p>}
          {items.map((e) => {
            const ed = edit[e.id];
            return (
              <article key={e.id} className={"mail " + e.status}>
                <div className="mail-head">
                  <div><button className="link name" onClick={() => onOpen(e.prospect_id)}>{e.prospect}</button>
                    <span className="pchip">{KIND_LABEL[e.kind]}{e.kind === "followup" ? ` ${e.step}` : ""}</span>
                    {me.admin && e.agent_name && <span className="pchip">{e.agent_name}</span>}</div>
                  <span className="muted small">To {e.contact_name ? `${e.contact_name} <${e.to_email}>` : e.to_email} · {e.sent_at ? `sent ${when(e.sent_at)}` : `due ${when(e.due_at)}`}</span>
                </div>
                {ed ? <div className="mail-edit">
                  <input id={`subj-${e.id}`} value={ed.subject} onChange={(x) => setEdit((m) => ({ ...m, [e.id]: { ...ed, subject: x.target.value } }))} />
                  <textarea id={`body-${e.id}`} rows={8} value={ed.body} onChange={(x) => setEdit((m) => ({ ...m, [e.id]: { ...ed, body: x.target.value } }))} />
                </div> : <><b className="subj">{e.subject}</b><pre className="draft">{e.body}</pre></>}
                {e.error && <div className="banner small">{e.error}</div>}
                {["draft", "failed", "approved"].includes(e.status) && <div className="row">
                  {ed ? <><button className="btn sm primary" disabled={busy === e.id} onClick={() => act(e, "edit", ed)}>Save changes</button>
                    <button className="btn sm" onClick={() => setEdit((m) => { const n = { ...m }; delete n[e.id]; return n; })}>Cancel</button></>
                  : <>{e.status !== "approved" && <button className="btn sm primary" disabled={busy === e.id} onClick={() => act(e, "approve")}>
                        {manual(e) ? "Approve" : "Approve and send"}</button>}
                      <button className="btn sm" onClick={() => setEdit((m) => ({ ...m, [e.id]: { subject: e.subject, body: e.body } }))}>Edit</button>
                      {manual(e) && <><a className="btn sm" href={mailto(e)}>Open in my email</a>
                        <button className="btn sm" disabled={busy === e.id} onClick={() => act(e, "sent_manually")}>I sent it</button></>}
                      <button className="link small" disabled={busy === e.id} onClick={() => act(e, "skip")}>Skip</button></>}
                </div>}
              </article>);
          })}
        </section>))}
    </div>
  );
}

const SETTING_LABELS: [string, string, "bool" | "int"][] = [
  ["auto_assign", "Assign new top prospects to agents automatically", "bool"],
  ["assign_per_run", "New leads assigned per analyst each hour", "int"],
  ["auto_draft", "Draft emails automatically", "bool"],
  ["auto_send", "Send drafts without waiting for approval", "bool"],
  ["daily_send_cap", "Most emails sent per day", "int"],
  ["no_reply_days", "Close a lead this many days after an unanswered permission email", "int"],
  ["notify_agents", "Email agents their new leads and tasks", "bool"],
];

function Team({ call, onChanged }: { call: ReturnType<typeof useAdmin>; onChanged: () => void }) {
  const [d, setD] = useState<{ agents: Agent[]; settings: Record<string, unknown>; mail: MailStatus } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", analysts: ANALYSTS.map((a) => a.key) as Analyst[], max_open: 25 });
  const [pin, setPin] = useState(""), [err, setErr] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(""), [testTo, setTestTo] = useState("");
  const load = useCallback(() => call<typeof d>("/admin/sales-team").then(setD).catch((e) => setErr(e.message)), [call]);
  useEffect(() => { load(); }, [load]);
  const run = async (k: string, f: () => Promise<void>) => { setBusy(k); setErr(""); setNote(""); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); } };
  if (!d) return <p className="muted">{err || "Loading the team…"}</p>;
  const toggle = (k: string, v: unknown) => run("set", async () => { await call("/admin/sales-settings", "PUT", { [k]: v }); await load(); });
  return (
    <div className="team">
      <section className="card"><h3>Account agents</h3>
        <div className="table-scroll"><table><thead><tr><th>Agent</th><th>Sells</th><th className="num">Open leads</th><th className="num">Won</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>{d.agents.map((a) => <tr key={a.id} className={a.active ? "" : "muted"}>
            <td><b>{a.name}</b><div className="muted small">{a.email}</div></td>
            <td className="small">{a.analysts.map((x) => ALABEL[x]?.replace(" Analyst", "")).join(", ")}</td>
            <td className="num">{a.open_leads} / {a.max_open}</td><td className="num">{a.won} ({R(a.won_zar)})</td>
            <td className="small">{a.last_login ? when(a.last_login) : "Never"}</td>
            <td className="row"><button className="btn sm" onClick={() => run("pin", async () => {
                const r = await call<{ pin: string }>(`/admin/sales-team/${a.id}`, "PATCH", { new_pin: true }); setPin(`${a.name}'s new PIN: ${r.pin}`); })}>New PIN</button>
              <button className="btn sm" onClick={() => run("act", async () => { await call(`/admin/sales-team/${a.id}`, "PATCH", { active: !a.active }); await load(); onChanged(); })}>
                {a.active ? "Deactivate" : "Activate"}</button></td></tr>)}
            {!d.agents.length && <tr><td colSpan={6} className="muted">No agents yet. Add your first below.</td></tr>}</tbody></table></div>
        <form className="add-agent" onSubmit={(e) => { e.preventDefault(); run("add", async () => {
          const r = await call<{ pin: string }>("/admin/sales-team", "POST", form); setPin(`${form.name}'s PIN: ${r.pin}`);
          setForm({ ...form, name: "", email: "" }); await load(); }); }}>
          <input id="ag-name" required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input id="ag-email" required type="email" placeholder="Work email (for lead and task emails)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="checks">{ANALYSTS.map((a) => <label key={a.key} className="small"><input type="checkbox" checked={form.analysts.includes(a.key)}
            onChange={(e) => setForm({ ...form, analysts: e.target.checked ? [...form.analysts, a.key] : form.analysts.filter((x) => x !== a.key) })} /> {a.label.replace(" Analyst", "")}</label>)}</div>
          <label className="small">Max open leads <input id="ag-max" type="number" min={1} max={500} value={form.max_open} onChange={(e) => setForm({ ...form, max_open: Number(e.target.value) })} /></label>
          <button className="btn primary" disabled={busy === "add"}>Add agent</button>
        </form>
        {pin && <div className="banner pin">{pin}. It is shown once: send it to them privately. They sign in at /crm/ as "Account agent".</div>}
      </section>
      <section className="card"><h3>Funnel</h3>
        <div className="settings">{SETTING_LABELS.map(([k, label, kind]) => <label key={k} className="setting">
          {kind === "bool" ? <input type="checkbox" checked={!!d.settings[k]} onChange={(e) => toggle(k, e.target.checked)} />
            : <input type="number" min={1} max={500} defaultValue={Number(d.settings[k])} onBlur={(e) => Number(e.target.value) !== Number(d.settings[k]) && toggle(k, Number(e.target.value))} />}
          <span>{label}</span></label>)}</div>
        <p className="muted small">The funnel runs every hour. Follow-ups to people who said yes go {(d.settings.followup_days as number[] || []).join(" and ")} days after the last email.</p>
        <button className="btn" disabled={!!busy} onClick={() => run("run", async () => {
          const r = await call<Record<string, number>>("/admin/sales-funnel/run", "POST");
          setNote(`Assigned ${r.assigned}, drafted ${r.drafted}, sent ${r.sent}, waiting for agents ${r.waiting_for_agent}, closed ${r.closed}, agents emailed ${r.agents_notified}.`); onChanged(); })}>
          {busy === "run" ? "Running…" : "Run the funnel now"}</button>
      </section>
      <section className="card"><h3>Email</h3>
        <ul className="mailst small">
          <li>Lead and task emails to agents: <b>{d.mail.system ? `${d.mail.system === "brevo" ? "Brevo" : "ZeptoMail"} (${d.mail.system === "brevo" ? d.mail.brevo_from : d.mail.zeptomail_from})` : "not set up"}</b></li>
          <li>Permission emails to prospects: <b>{d.mail.permission === "smtp" ? `sales mailbox ${d.mail.outreach_from}` : "agents send from their own mail app"}</b></li>
          <li>Emails to prospects who said yes: <b>{d.mail.consented === "brevo" ? "Brevo" : d.mail.consented === "smtp" ? "sales mailbox" : "agents send from their own mail app"}</b></li>
        </ul>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run("test", async () => { const r = await call<Record<string, string>>("/admin/mail/test", "POST", { to: testTo });
          setNote(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(" · ")); }); }}>
          <input id="mail-test" type="email" required placeholder="Send a test email to…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <button className="btn" disabled={!!busy}>Send test</button></form>
      </section>
      {note && <div className="banner ok">{note}</div>}
      {err && <div className="banner">{err}</div>}
    </div>
  );
}

function App() {
  const [key, setKey] = useState(() => { try { return localStorage.getItem(AGENT_STORE) || localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } });
  const [err, setErr] = useState("");
  const badKey = useCallback(() => { setKey(""); setMe(null); try { localStorage.removeItem(KEY_STORE); localStorage.removeItem(AGENT_STORE); } catch { /* */ } }, []);
  const call = useAdmin(key, badKey);
  const [me, setMe] = useState<Me | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    if (!key) return;
    call<Me>("/sales/me").then((m) => { setMe(m); if (m.admin) call<{ agents: Agent[] }>("/admin/sales-team").then((t) => setAgents(t.agents)).catch(() => {}); })
      .catch((e) => setErr(`${(e as Error).message} The free analyst server can take a minute to wake up.`));
  }, [key, call]);
  const [analyst, setAnalyst] = useState<Analyst>(() => (["property", "retail", "marketplace", "jobs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "property") as Analyst);
  const [view, setView] = useState<"ranked" | "board" | "outbox" | "enquiries" | "team">("ranked");
  const [data, setData] = useState<BoardData | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(""), [q, setQ] = useState(""), [boardAll, setBoardAll] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!key) return;
    setErr("");
    try { setData(await call<BoardData>(`/admin/sales?analyst=${analyst}`)); }
    catch (e) { setErr(`${(e as Error).message}. The free analyst server can take a minute to wake up; try again.`); }
  }, [key, analyst, call]);
  useEffect(() => { load(); location.hash = analyst; }, [load, analyst]);

  const move = async (id: number, stage: Stage) => {
    setData((d) => d && { ...d, board: d.board.map((p) => (p.id === id ? { ...p, stage } : p)) });
    try { await call(`/admin/sales/${id}`, "PATCH", { stage }); } catch (e) { setErr((e as Error).message); }
    load();
  };
  const pin = async (id: number) => { try { await call(`/admin/sales/${id}`, "PATCH", { pinned: true }); load(); } catch (e) { setErr((e as Error).message); } };
  const rescore = async () => {
    setBusy("score"); setErr("");
    try { const r = await call<Record<string, unknown>>(`/admin/sales/score?analyst=${analyst}`, "POST");
      const v = r[analyst]; if (typeof v === "string") setErr(`Ranking failed: ${v}`); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };

  const ranked = useMemo(() => (data?.ranked || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const board = useMemo(() => (data?.board || []).filter((p) => (boardAll || p.analyst === analyst)), [data, boardAll, analyst]);
  const count = (a: Analyst) => data?.counts.find((c) => c.analyst === a)?.n;
  const scoredAt = data?.counts.find((c) => c.analyst === analyst)?.scored_at;
  const open$ = (data?.totals || []).filter((t) => !["won", "lost"].includes(t.stage));
  const pipeline = open$.reduce((a, t) => a + Number(t.value_zar), 0), won = data?.totals.find((t) => t.stage === "won");

  return (
    <div className="wrap crm">
      <PlatformNav active="/crm/" />
      {!key ? <KeyGate error={err} onKey={(k) => { setKey(k); try { localStorage.setItem(KEY_STORE, k); } catch { /* */ } }}
        onAgent={(t) => { setKey(t); try { localStorage.setItem(AGENT_STORE, t); } catch { /* */ } }} /> : !me ? <p className="muted">{err || "Signing in…"}</p> : (<>
        <header className="crm-head">
          <div><h1>Sales pipeline</h1>
            <p className="muted">{me.admin ? "Who to sell each analyst to, ranked from our own data every morning, and where every deal stands."
              : `Signed in as ${me.name}. Your leads, your outbox and your next steps.`} <button className="link small" onClick={badKey}>Sign out</button></p></div>
          <div className="crm-kpis">
            <div><b>{open$.reduce((a, t) => a + t.n, 0)}</b><span>open deals</span></div>
            <div><b>{R(pipeline)}</b><span>pipeline / month</span></div>
            <div><b>{won?.n || 0}</b><span>won ({R(won?.value_zar)} / month)</span></div>
          </div>
        </header>
        <nav className="crm-tabs" role="tablist" aria-label="Analyst">
          {ANALYSTS.map((a) => <button key={a.key} role="tab" aria-selected={analyst === a.key} onClick={() => setAnalyst(a.key)}>
            {a.label}{count(a.key) !== undefined && <em>{count(a.key)}</em>}</button>)}
        </nav>
        <div className="crm-bar">
          <div className="seg" role="group" aria-label="View">
            <button aria-pressed={view === "ranked"} onClick={() => setView("ranked")}>Ranked prospects</button>
            <button aria-pressed={view === "board"} onClick={() => setView("board")}>Board</button>
            <button aria-pressed={view === "outbox"} onClick={() => setView("outbox")}>Outbox</button>
            {me.admin && <button aria-pressed={view === "enquiries"} onClick={() => setView("enquiries")}>Enquiries</button>}
            {me.admin && <button aria-pressed={view === "team"} onClick={() => setView("team")}>Team &amp; settings</button>}
          </div>
          {view === "outbox" || view === "team" || view === "enquiries" ? null : view === "ranked" ? <input id="crm-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${ANALYSTS.find((a) => a.key === analyst)?.who}`} />
            : <label className="small"><input type="checkbox" checked={boardAll} onChange={(e) => setBoardAll(e.target.checked)} /> All analysts</label>}
          {(view === "ranked" || view === "board") && <span className="muted small">{scoredAt ? `Ranked ${when(scoredAt)}` : "Not ranked yet"}</span>}
          {me.admin && view === "ranked" && <button className="btn sm" onClick={rescore} disabled={!!busy}>{busy ? "Ranking…" : "Re-rank from today's data"}</button>}
        </div>
        {err && <div className="banner">{err}</div>}
        {!data && !err && <p className="muted">Loading…</p>}

        {data && view === "ranked" && (ranked.length ? (
          <ol className="ranked">{ranked.map((p) => (
            <li key={p.id} className={p.pinned ? "on-board" : ""}>
              <span className="rk">{p.rank ? `#${p.rank}` : "—"}</span>
              <div className="who"><button className="link name" onClick={() => setOpen(p.id)}>{p.name}</button>
                <span className="pchip">{p.segment}</span>{p.pinned && <span className="pchip stage">{STAGE_LABEL[p.stage]}</span>}
                {p.agent_name && <span className="pchip">{p.agent_name}</span>}
                <p>{p.reasons[0]}</p>{p.reasons[1] && <p className="muted">{p.reasons[1]}</p>}</div>
              <Score v={p.score} />
              <div className="acts-col">{p.pinned ? <button className="btn sm" onClick={() => setOpen(p.id)}>Open</button>
                : <button className="btn sm primary" onClick={() => pin(p.id)}>Add to board</button>}</div>
            </li>))}</ol>
        ) : <div className="card empty"><h3>No ranked prospects yet</h3>
          <p className="muted">Click <b>Re-rank from today's data</b>. After that the list refreshes every morning with the data.</p></div>)}

        {data && view === "board" && (
          <div className="board">{STAGES.map((s) => {
            const cards = board.filter((p) => p.stage === s);
            return (
              <section key={s} className={"col" + (dragId ? " droppable" : "")} aria-label={STAGE_LABEL[s]}
                onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragId) move(dragId, s); setDragId(null); }}>
                <h3>{STAGE_LABEL[s]} <em>{cards.length}</em></h3>
                {cards.map((p) => (
                  <article key={p.id} className="deal" draggable onDragStart={() => setDragId(p.id)} onDragEnd={() => setDragId(null)}>
                    <button className="link name" onClick={() => setOpen(p.id)}>{p.name}</button>
                    <div className="muted small">{ALABEL[p.analyst]} · {R(p.value_zar)}/m{p.agent_name ? ` · ${p.agent_name}` : ""}</div>
                    {p.consent !== "unknown" && <div className="small consent">{CONSENT_LABEL[p.consent]}</div>}
                    {p.next_step && <div className="small next">{p.next_step}{p.next_date ? ` · ${p.next_date.slice(0, 10)}` : ""}</div>}
                    <select aria-label={`Move ${p.name}`} value={p.stage} onChange={(e) => move(p.id, e.target.value as Stage)}>
                      {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}</select>
                  </article>))}
                {!cards.length && <p className="muted small hint">{s === "prospect" ? "Add prospects from the ranked list." : "Drag a card here."}</p>}
              </section>);
          })}</div>
        )}
        <p className="muted small foot">Prospects are businesses found in public market data. Add a contact person only from a business source, keep notes factual, and mark anyone who opts out as "Do not contact".</p>
        {view === "outbox" && <Outbox call={call} me={me} onOpen={setOpen} />}
        {view === "enquiries" && me.admin && <Enquiries call={call} onOpen={setOpen} />}
        {view === "team" && me.admin && <Team call={call} onChanged={() => { load(); call<{ agents: Agent[] }>("/admin/sales-team").then((t) => setAgents(t.agents)).catch(() => {}); }} />}
        {open !== null && <><div className="scrim" onClick={() => setOpen(null)} /><Detail id={open} call={call} me={me} agents={agents} onClose={() => setOpen(null)} onChanged={load} /></>}
      </>)}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
