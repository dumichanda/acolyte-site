import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./crm.css";
import PlatformNav from "../PlatformNav";
import { API } from "../auth";

/**
 * Acolyte's own sales CRM. Prospects for each industry analyst are ranked from our datasets
 * (agencies from property listings, retailers and online stores from prices, employers and recruiters from job ads).
 * Everything goes through the analyst API with the owner's admin key; nothing private is on the public site.
 */
const KEY_STORE = "acolyteAdminKey";
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
}
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
    if (r.status === 401) { onBadKey(); throw new Error("That admin key isn't right."); }
    if (!r.ok) throw new Error(d.detail || r.statusText);
    return d as T;
  }, [key, onBadKey]);
}

function KeyGate({ onKey, error }: { onKey: (k: string) => void; error: string }) {
  const [k, setK] = useState("");
  return (
    <form className="card crm-gate" onSubmit={(e) => { e.preventDefault(); if (k.trim()) onKey(k.trim()); }}>
      <span className="tag">Private</span>
      <h2>Sign in to the sales CRM</h2>
      <p className="muted">Use the same admin key as the admin page. The CRM lives in a private schema in the database; the public site only shows this sign-in.</p>
      <div className="row"><input id="crm-key" type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="Admin key" autoComplete="current-password" />
        <button className="btn primary">Open CRM</button></div>
      {error && <div className="banner">{error}</div>}
    </form>
  );
}

function Score({ v }: { v: number }) {
  return <span className="score" title={`Fit score ${Math.round(v)} / 100`}><i style={{ width: `${Math.max(4, Math.min(100, v))}%` }} /><b>{Math.round(v)}</b></span>;
}

function Detail({ id, call, onClose, onChanged }: { id: number; call: ReturnType<typeof useAdmin>; onClose: () => void; onChanged: () => void }) {
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
        <h3>First email</h3>
        <p className="muted small">Drafted from the reasons above; nothing is sent. Copy it into your own email, then log it below.</p>
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

function App() {
  const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } });
  const [err, setErr] = useState("");
  const badKey = useCallback(() => { setKey(""); try { localStorage.removeItem(KEY_STORE); } catch { /* */ } }, []);
  const call = useAdmin(key, badKey);
  const [analyst, setAnalyst] = useState<Analyst>(() => (["property", "retail", "marketplace", "jobs"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "property") as Analyst);
  const [view, setView] = useState<"ranked" | "board">("ranked");
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
  const board = useMemo(() => (data?.board || []).filter((p) => boardAll || p.analyst === analyst), [data, boardAll, analyst]);
  const count = (a: Analyst) => data?.counts.find((c) => c.analyst === a)?.n;
  const scoredAt = data?.counts.find((c) => c.analyst === analyst)?.scored_at;
  const open$ = (data?.totals || []).filter((t) => !["won", "lost"].includes(t.stage));
  const pipeline = open$.reduce((a, t) => a + Number(t.value_zar), 0), won = data?.totals.find((t) => t.stage === "won");

  return (
    <div className="wrap crm">
      <PlatformNav active="/crm/" />
      {!key ? <KeyGate error={err} onKey={(k) => { setKey(k); try { localStorage.setItem(KEY_STORE, k); } catch { /* */ } }} /> : (<>
        <header className="crm-head">
          <div><h1>Sales pipeline</h1>
            <p className="muted">Who to sell each analyst to, ranked from our own data every morning, and where every deal stands.</p></div>
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
          </div>
          {view === "ranked" ? <input id="crm-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${ANALYSTS.find((a) => a.key === analyst)?.who}`} />
            : <label className="small"><input type="checkbox" checked={boardAll} onChange={(e) => setBoardAll(e.target.checked)} /> All analysts</label>}
          <span className="muted small">{scoredAt ? `Ranked ${when(scoredAt)}` : "Not ranked yet"}</span>
          <button className="btn sm" onClick={rescore} disabled={!!busy}>{busy ? "Ranking…" : "Re-rank from today's data"}</button>
        </div>
        {err && <div className="banner">{err}</div>}
        {!data && !err && <p className="muted">Loading…</p>}

        {data && view === "ranked" && (ranked.length ? (
          <ol className="ranked">{ranked.map((p) => (
            <li key={p.id} className={p.pinned ? "on-board" : ""}>
              <span className="rk">{p.rank ? `#${p.rank}` : "—"}</span>
              <div className="who"><button className="link name" onClick={() => setOpen(p.id)}>{p.name}</button>
                <span className="pchip">{p.segment}</span>{p.pinned && <span className="pchip stage">{STAGE_LABEL[p.stage]}</span>}
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
                    <div className="muted small">{ALABEL[p.analyst]} · {R(p.value_zar)}/m</div>
                    {p.next_step && <div className="small next">{p.next_step}{p.next_date ? ` · ${p.next_date.slice(0, 10)}` : ""}</div>}
                    <select aria-label={`Move ${p.name}`} value={p.stage} onChange={(e) => move(p.id, e.target.value as Stage)}>
                      {STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}</select>
                  </article>))}
                {!cards.length && <p className="muted small hint">{s === "prospect" ? "Add prospects from the ranked list." : "Drag a card here."}</p>}
              </section>);
          })}</div>
        )}
        <p className="muted small foot">Prospects are businesses found in public market data. Add a contact person only from a business source, keep notes factual, and mark anyone who opts out as "Do not contact".</p>
        {open !== null && <><div className="scrim" onClick={() => setOpen(null)} /><Detail id={open} call={call} onClose={() => setOpen(null)} onChanged={load} /></>}
      </>)}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
