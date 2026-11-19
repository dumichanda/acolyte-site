/** Shared dashboard pieces: filter bar, key insights panel and the "Ask Acolyte AI" bar (used by client and public dashboards). */
import { useRef, useState, type ReactNode } from "react";
import { API, getToken } from "../auth";
import "./view.css";
import { DEFAULT_FILTERS, PERIODS, type Filters, type Insight, type Period } from "./insights";

const TONE_ICON: Record<Insight["tone"], string> = { up: "▲", down: "▼", flat: "■", info: "●" };

export function FilterBar({ f, set, dims, base = DEFAULT_FILTERS }: { f: Filters; set: (f: Filters) => void; dims: { col: string; values: string[] }[]; base?: Filters }) {
  const changed = f.period !== base.period || Object.values(f.dims).some(Boolean);
  return (
    <div className="filter-bar" role="group" aria-label="Dashboard filters">
      <label>Period
        <select value={f.period} onChange={(e) => set({ ...f, period: e.target.value as Period })}>
          {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {dims.map((d) => (
        <label key={d.col}>{d.col}
          <select value={f.dims[d.col] || ""} onChange={(e) => set({ ...f, dims: { ...f.dims, [d.col]: e.target.value } })}>
            <option value="">All</option>{d.values.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>))}
      {changed && <button className="link" onClick={() => set(base)}>{base.period === "month" ? "Reset to this month" : "Clear filters"}</button>}
    </div>
  );
}

function md(text: string) {   // tiny markdown: **bold**, bullets, paragraphs
  return text.split(/\n{2,}/).map((para, i) => {
    const lines = para.split("\n");
    const bold = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((x, k) => (k % 2 ? <b key={k}>{x}</b> : x));
    if (lines.every((l) => /^\s*[-•*]\s/.test(l))) return <ul key={i}>{lines.map((l, k) => <li key={k}>{bold(l.replace(/^\s*[-•*]\s/, ""))}</li>)}</ul>;
    return <p key={i}>{lines.map((l, k) => <span key={k}>{bold(l)}{k < lines.length - 1 && <br />}</span>)}</p>;
  });
}

export function AskBar({ context, industry, suggestions }: { context: () => string; industry?: string; suggestions: string[] }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ans, setAns] = useState<{ q: string; text: string; status: string; error?: string } | null>(null);
  const session = useRef<string | null>(null);
  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true); setQ(""); setAns({ q: question, text: "", status: "Reading the dashboard…" });
    try {
      const token = getToken();
      const r = await fetch(`${API}/ask`, { method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ session_id: session.current, question, mode: "auto", context: context(),
          style: (() => { try { return localStorage.getItem("analystStyle") || "balanced"; } catch { return "balanced"; } })(),
          ...(industry && industry !== "all" ? { industry } : {}) }) });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).detail || "Acolyte AI is unavailable.");
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: ")); buf = buf.slice(i + 2);
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "session") session.current = ev.session_id;
          else if (ev.type === "text") setAns((a) => a && { ...a, text: a.text + ev.text, status: "" });
          else if (ev.type === "status") setAns((a) => a && { ...a, status: ev.text });
          else if (ev.type === "error") setAns((a) => a && { ...a, error: ev.text });
        }
      }
    } catch (e) { setAns((a) => a && { ...a, error: (e as Error).message }); }
    finally { setBusy(false); setAns((a) => a && { ...a, status: "" }); }
  }
  return (
    <div className="ask-view">
      {ans && <div className="ask-answer">
        <div className="ask-q">You asked: <b>{ans.q}</b></div>
        {ans.text ? <div className="ask-text">{md(ans.text)}</div> : !ans.error && <div className="muted small">{ans.status || "Thinking…"}</div>}
        {ans.text && ans.status && <div className="muted small">{ans.status}</div>}
        {ans.error && <div className="err">{ans.error}</div>}
      </div>}
      <form className="ask-bar" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <span className="ask-badge">Ask Acolyte AI</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question about what's on this dashboard…" aria-label="Ask Acolyte AI about this dashboard" disabled={busy} />
        <button className="btn primary sm" disabled={busy || !q.trim()}>{busy ? "Answering…" : "Ask"}</button>
      </form>
      {!ans && <div className="ask-sugg">{suggestions.map((s) => <button key={s} type="button" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>}
    </div>
  );
}

export function KeyInsights({ items, label, ask }: { items: Insight[]; label: string; ask?: ReactNode }) {
  return (
    <section className="card insights">
      <div className="ins-head"><h2>Key insights</h2><span className="muted small">{label} · updates with your filters</span></div>
      {items.length ? <div className="ins-grid">{items.map((x, i) => (
        <div key={i} className={"ins t-" + x.tone}><i aria-hidden>{TONE_ICON[x.tone]}</i><div><p>{x.text}</p><span className="muted small">{x.tile}</span></div></div>))}</div>
        : <p className="muted">No data in this view yet. Try a longer period or clear a filter.</p>}
      {ask}
    </section>
  );
}
