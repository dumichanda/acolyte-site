import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactECharts from "../Chart";
import "../index.css";
import "./reports.css";
import PlatformNav from "../PlatformNav";
import { url } from "../site";
import { readTheme } from "../charts";
import { chartOption, fmt, type ChartArtifact, type ReportArtifact } from "../analyst/chart";
import { DeckStyle, useDeckTheme } from "../analyst/DeckStyle";
import { keyInsights, viewContext, DEFAULT_FILTERS } from "../dashboards/insights";
import { AskBar, KeyInsights } from "../dashboards/view";
import { ANALYSTS, latestPerAnalyst, loadIndex, loadReport, monthLabel, type ReportCard, type ReportFile } from "./data";

const exporter = () => import("../analyst/export");

function Kpis({ items }: { items?: { value: string; label: string; context: string; tone: string }[] }) {
  if (!items?.length) return null;
  return <div className="rp-kpis">{items.map((k, i) => (
    <div key={i} className={"rp-kpi t-" + k.tone}><span>{k.label}</span><b>{k.value}</b>{k.context && <em>{k.context}</em>}</div>))}</div>;
}

function ChartBlock({ c, height = 300 }: { c: ChartArtifact; height?: number }) {
  const t = useMemo(() => readTheme(), []);
  if (c.type === "kpi") {
    const yi = c.columns.indexOf(c.y[0]);
    return <div className="rp-bigkpi"><b>{fmt(c.rows[0]?.[yi], c.value_format)}</b><span>{c.y[0]}</span></div>;
  }
  if (c.type === "table") {
    const idx = [c.columns.indexOf(c.x), ...c.y.map((y) => c.columns.indexOf(y))].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
    return (
      <div className="rp-table"><table>
        <thead><tr>{idx.map((i) => <th key={i}>{c.columns[i]}</th>)}</tr></thead>
        <tbody>{c.rows.slice(0, 15).map((r, k) => <tr key={k}>{idx.map((i) => (
          <td key={i} className={typeof r[i] === "number" ? "num" : ""}>
            {typeof r[i] === "number" ? fmt(r[i], c.y.includes(c.columns[i]) ? c.value_format : "number") : String(r[i] ?? "—")}</td>))}</tr>)}</tbody>
      </table></div>
    );
  }
  return <ReactECharts style={{ height }} option={chartOption(c, t)} notMerge />;
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

function Dashboards({ cards, files }: { cards: ReportCard[]; files: Record<number, ReportFile> }) {
  return (
    <section className="rp-dash">
      <h2>Dashboards</h2>
      <p className="muted">A preview of each analyst's dashboard, drawn from its latest report. Clients get these live, refreshed every morning, with their own data alongside.</p>
      {cards.map((c) => {
        const f = files[c.id];
        const charts = f ? Object.values(f.report.charts || {}).filter((x) => x.type !== "table").slice(0, 4) : [];
        if (!charts.length) return null;
        return (
          <div key={c.id} className="rp-board">
            <div className="rp-board-head"><h3>{ANALYSTS[c.industry]?.name}</h3><span className="muted small">{monthLabel(c.period, c.month_to_date)}</span>
              <a className="link" href={url(ANALYSTS[c.industry]?.ask || "/analyst/")}>Open in Ask AI →</a></div>
            <KeyInsights items={keyInsights(charts, 4)} label={monthLabel(c.period, c.month_to_date)}
              ask={<AskBar industry={c.industry} suggestions={["What stands out here?", "Is this good or bad news?", "What should I do about it?"]}
                context={() => viewContext(`${ANALYSTS[c.industry]?.name} dashboard (${monthLabel(c.period, c.month_to_date)})`, DEFAULT_FILTERS,
                  charts.map((ch) => ({ chart: ch, note: "", timed: true })), keyInsights(charts, 4))} />} />
            <div className="rp-tiles">{charts.map((ch) => <div key={ch.id} className="rp-tile"><h4>{ch.title}</h4><ChartBlock c={ch} height={230} /></div>)}</div>
          </div>
        );
      })}
    </section>
  );
}

function App() {
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  const [files, setFiles] = useState<Record<number, ReportFile>>({});
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState<number | null>(() => Number((location.hash.match(/^#report-(\d+)$/) || [])[1]) || null);

  useEffect(() => { loadIndex().then(setCards); }, []);
  useEffect(() => {
    const onHash = () => setOpen(Number((location.hash.match(/^#report-(\d+)$/) || [])[1]) || null);
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const latest = useMemo(() => latestPerAnalyst(cards || []), [cards]);
  useEffect(() => {   // latest reports (for dashboards) and the open one
    const want = [...latest.map((c) => c.id), ...(open ? [open] : [])].filter((id) => !files[id]);
    want.forEach((id) => loadReport(id).then((f) => f && setFiles((m) => ({ ...m, [id]: f }))));
  }, [latest, open]);  // eslint-disable-line react-hooks/exhaustive-deps

  const show = (id: number | null) => { location.hash = id ? `report-${id}` : ""; setOpen(id); scrollTo(0, 0); };
  const shown = (cards || []).filter((c) => filter === "all" || c.industry === filter);

  return (
    <div className="wrap reports-page">
      <PlatformNav active="/reports/" />
      {open ? (files[open] ? <Reader f={files[open]} onBack={() => show(null)} /> : <p className="muted">Loading the report…</p>) : (
        <>
          <header className="rp-head">
            <h1>Reports &amp; dashboards</h1>
            <p className="muted">Monthly report packs from each Acolyte analyst, written from live South African market data. A new edition arrives on the 1st of every month. Read them here, or download the PowerPoint and PDF.</p>
            <div className="rp-filters" role="group" aria-label="Filter by analyst">
              {[["all", "All analysts"], ...Object.entries(ANALYSTS).map(([k, v]) => [k, v.name])].map(([k, label]) => (
                <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>))}
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
          {filter === "all" && <Dashboards cards={latest} files={files} />}
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
