import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./reports.css";
import "../dashboards/view.css";
import PlatformNav from "../PlatformNav";
import { url } from "../site";
import type { ReportArtifact } from "../analyst/chart";
import ChartBlock from "./ChartBlock";
import { DeckStyle, useDeckTheme } from "../analyst/DeckStyle";
import { ANALYSTS, loadIndex, loadReport, monthLabel, type ReportCard, type ReportFile } from "./data";

const exporter = () => import("../analyst/export");

function Kpis({ items }: { items?: { value: string; label: string; context: string; tone: string }[] }) {
  if (!items?.length) return null;
  return <div className="rp-kpis">{items.map((k, i) => (
    <div key={i} className={"rp-kpi t-" + k.tone}><span>{k.label}</span><b>{k.value}</b>{k.context && <em>{k.context}</em>}</div>))}</div>;
}

function Downloads({ r }: { r: ReportArtifact }) {
  const [busy, setBusy] = useState("");
  const [theme, setTheme] = useDeckTheme();
  const run = async (key: string, f: () => Promise<void>) => { setBusy(key); try { await f(); } finally { setBusy(""); } };
  return (
    <div className="rp-dl">
      <DeckStyle value={theme} onChange={setTheme} />
      <span className="muted small">Executive brief (5 slides)</span>
      <button className="btn sm primary" disabled={!!busy} onClick={() => run("ep", async () => (await exporter()).reportToPptx(r, "executive", theme))}>{busy === "ep" ? "Preparing…" : "PowerPoint"}</button>
      <button className="btn sm" disabled={!!busy} onClick={() => run("ed", async () => (await exporter()).reportToPdf(r, "executive", theme))}>{busy === "ed" ? "Preparing…" : "PDF"}</button>
      <span className="muted small">Story (picture-led, plain language)</span>
      <button className="btn sm" disabled={!!busy} onClick={() => run("sp", async () => (await exporter()).reportToPptx(r, "story", theme))}>{busy === "sp" ? "Preparing…" : "PowerPoint"}</button>
      <button className="btn sm" disabled={!!busy} onClick={() => run("sd", async () => (await exporter()).reportToPdf(r, "story", theme))}>{busy === "sd" ? "Preparing…" : "PDF"}</button>
      <span className="muted small">Full pack</span>
      <button className="btn sm" disabled={!!busy} onClick={() => run("fp", async () => (await exporter()).reportToPptx(r, "standard", theme))}>{busy === "fp" ? "Preparing…" : "PowerPoint"}</button>
      <button className="btn sm" disabled={!!busy} onClick={() => run("fd", async () => (await exporter()).reportToPdf(r, "standard", theme))}>{busy === "fd" ? "Preparing…" : "PDF"}</button>
    </div>
  );
}

function Reader({ f, onBack }: { f: ReportFile; onBack: () => void }) {
  const r = f.report, ex = r.exec, a = ANALYSTS[f.industry];
  return (
    <article className="rp-reader">
      <button className="link back" onClick={onBack}>← All reports</button>
      <div className="rp-meta"><span className="pill">{a?.name || f.analyst}</span><span className="muted">{monthLabel(f.period, f.month_to_date)}</span></div>
      <h1>{r.title}</h1>
      {r.scope && <p className="muted">{r.scope}</p>}
      <p className="muted small">Demonstration report on public South African market data, shown as summaries and trends. Acolyte is an AI analyst, not a data supplier.</p>
      <Downloads r={r} />
      {ex?.takeaway && <section className="rp-exec">
        <h2>{ex.title || "Summary"}</h2>
        <p className="lead">{ex.takeaway}</p>
        <Kpis items={ex.kpis} />
        {ex.so_what && <div className="rp-box so"><b>So what</b><p>{ex.so_what}</p></div>}
      </section>}
      {r.sections.map((s, i) => (
        <section key={i} className="rp-section">
          {s.question && <div className="rp-q">Q{i + 1} · {s.question}</div>}
          <h2>{s.title || s.heading}</h2>
          {s.takeaway && <p className="lead">{s.takeaway}</p>}
          <Kpis items={s.kpis} />
          {s.chart_ids.map((id) => r.charts[id] && <div key={id} className="rp-chart"><h3>{r.charts[id].title}</h3>
            {r.charts[id].subtitle && <p className="muted small">{r.charts[id].subtitle}</p>}<ChartBlock c={r.charts[id]} /></div>)}
          <div className="rp-boxes">
            {s.so_what && <div className="rp-box so"><b>So what</b><p>{s.so_what}</p></div>}
            {s.note && <div className="rp-box note"><b>How to read it</b><p>{s.note}</p></div>}
            {(s.explainers || []).map((e, k) => <div key={"x" + k} className="rp-box note explain"><b>In plain words · {e.term}</b><p>{e.means}</p><p><i>Why it matters:</i> {e.why}</p></div>)}
          </div>
        </section>
      ))}
      {r.conclusions?.actions?.length ? <section className="rp-section"><h2>Recommended actions</h2>
        <ol>{r.conclusions.actions.map((x, i) => <li key={i}>{x}</li>)}</ol>
        {r.conclusions.risks?.length ? <><h3>Watch-outs</h3><ul>{r.conclusions.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      </section> : null}
{r.sources?.length ? <section className="rp-section"><h2>What others are saying</h2>
        <p className="muted small">Outside sources found by the analyst's web research, quoted to back up or challenge a finding. Our data remains the evidence.</p>
        {r.sources.map((x, i) => <blockquote key={i} className="src-quote"><p>“{x.quote}”</p>
          <footer>{x.publisher || x.title}{x.date ? `, ${x.date}` : ""} · <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title || "source"}</a></footer>
          {x.point && <p className="muted small">{x.point}</p>}</blockquote>)}
      </section> : null}
      {r.method?.steps?.length ? <section className="rp-section"><h2>How this was built</h2>
        <ul>{r.method.steps.map((x, i) => <li key={i}>{x}</li>)}</ul>
        {r.method.limits?.length ? <><h3>Limits</h3><ul>{r.method.limits.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null}
      </section> : null}
      <div className="rp-cta">
        <p><b>Want this for your own market, every month, with your data next to it?</b> Ask the {a?.name || "analyst"} a follow-up question, or book a session.</p>
        <div className="row"><a className="btn primary" href={url(a?.ask || "/analyst/")}>Ask the {a?.name || "analyst"}</a>
          <a className="btn" href={url("/#contact")}>Book a session</a></div>
      </div>
    </article>
  );
}

export function Card({ r, onOpen }: { r: ReportCard; onOpen: () => void }) {
  const a = ANALYSTS[r.industry];
  return (
    <article className="rp-card">
      <div className="rp-meta"><span className="pill">{a?.name || r.analyst}</span><span className="muted small">{monthLabel(r.period, r.month_to_date)}</span></div>
      <h3>{r.title}</h3>
      {r.takeaway && <p className="muted">{r.takeaway.length > 220 ? r.takeaway.slice(0, 217) + "…" : r.takeaway}</p>}
      <Kpis items={r.kpis} />
      <button className="btn sm primary" onClick={onOpen}>Read the report</button>
    </article>
  );
}

function App() {
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  const [files, setFiles] = useState<Record<number, ReportFile>>({});
  const [filter, setFilter] = useState<string>("all");
  const [month, setMonth] = useState("all"), [kind, setKind] = useState("all"), [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(() => Number((location.hash.match(/^#report-(\d+)$/) || [])[1]) || null);

  useEffect(() => { loadIndex().then(setCards); }, []);
  useEffect(() => {
    const onHash = () => setOpen(Number((location.hash.match(/^#report-(\d+)$/) || [])[1]) || null);
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {   // the open report
    const want = (open ? [open] : []).filter((id) => !files[id]);
    want.forEach((id) => loadReport(id).then((f) => f && setFiles((m) => ({ ...m, [id]: f }))));
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  const show = (id: number | null) => { location.hash = id ? `report-${id}` : ""; setOpen(id); scrollTo(0, 0); };
  const months = [...new Set((cards || []).map((c) => c.period))].sort().reverse();
  const stem = (w: string) => w.replace(/(ies|es|s)$/, "");   // "yields" finds "yield"
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).map(stem);
  const shown = (cards || []).filter((c) => (filter === "all" || c.industry === filter) && (month === "all" || c.period === month)
    && (kind === "all" || (kind === "mtd") === c.month_to_date)
    && words.every((w) => `${c.title} ${c.takeaway || ""} ${ANALYSTS[c.industry]?.name || ""} ${(c.kpis || []).map((k) => k.label).join(" ")}`.toLowerCase().includes(w)));
  const filtered = filter !== "all" || month !== "all" || kind !== "all" || !!words.length;

  return (
    <div className="wrap reports-page">
      <PlatformNav active="/reports/" />
      {open ? (files[open] ? <Reader f={files[open]} onBack={() => show(null)} /> : <p className="muted">Loading the report…</p>) : (
        <>
          <header className="rp-head">
            <h1>Reports</h1>
            <p className="muted">Monthly report packs from each Acolyte analyst, written on public South African market data to show what an analyst can do. Your own analyst writes the same packs on your data. A new edition arrives on the 1st of every month. Read them here, or download the PowerPoint and PDF.</p>
            <div className="rp-filters" role="group" aria-label="Filter by analyst">
              {[["all", "All analysts"], ...Object.entries(ANALYSTS).map(([k, v]) => [k, v.name])].map(([k, label]) => (
                <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>))}
            </div>
            <div className="filter-bar rp-more" role="group" aria-label="More filters">
              <label>Month
                <select value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="all">All months</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m, false)}</option>)}</select></label>
              <label>Edition
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="all">All editions</option><option value="full">Full month</option><option value="mtd">Month to date</option></select></label>
              <label className="rp-search">Search
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. yields, Black Friday, Takealot" /></label>
              {filtered && <button className="link" onClick={() => { setFilter("all"); setMonth("all"); setKind("all"); setQ(""); }}>Clear filters</button>}
              <span className="muted small">{shown.length} of {(cards || []).length} reports</span>
            </div>
          </header>
          {cards === null ? <p className="muted">Loading reports…</p> : shown.length ? (
            <div className="rp-grid">{shown.map((r) => <Card key={r.id} r={r} onOpen={() => show(r.id)} />)}</div>
          ) : (
            <div className="rp-empty">
              <h2>The first monthly reports are being written</h2>
              <p className="muted">Each analyst publishes a report pack here on the 1st of every month: what changed, trends and patterns, a 5-month look-back on demand, and actions for the month ahead. Until then, ask an analyst directly.</p>
              <div className="row">{Object.entries(ANALYSTS).map(([k, v]) => <a key={k} className="btn" href={url(v.ask)}>{v.name}</a>)}</div>
            </div>
          )}
          <p className="muted rp-to-dash">Looking for the dashboards? Each analyst's live dashboards, with several sheets, are on the <a href={url("/dashboards/")}>Dashboards</a> page.</p>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
