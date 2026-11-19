import { useEffect, useMemo, useState } from "react";
import { url } from "../site";
import { vary, type ChartArtifact, type Kpi, type ReportArtifact } from "../analyst/chart";
import ChartBlock from "../reports/ChartBlock";
import { ANALYSTS, latestPerAnalyst, loadIndex, loadReport, monthLabel, type ReportCard, type ReportFile } from "../reports/data";
import { applyFilters, dimensions, keyInsights, viewContext, type Filters } from "./insights";
import { AskBar, FilterBar, KeyInsights } from "./view";

const ALL: Filters = { period: "all", dims: {} };   // sample data is a snapshot: show everything until filtered
import "../reports/reports.css";

/**
 * Sample dashboards for visitors: one per analyst, built from its latest monthly work, split into sheets
 * (an overview plus one sheet per topic) so it reads like a real workbook, with charts drawn in varied forms.
 */
interface Sheet { key: string; name: string; intro?: string; kpis?: Kpi[]; charts: ChartArtifact[]; so_what?: string }

const short = (t: string) => {
  const w = (t || "").replace(/(?:[;:]|,\s|\.\s).*$/, "").split(/\s+/).filter(Boolean);
  return w.slice(0, 4).join(" ") + (w.length > 4 ? "…" : "");
};

function sheetsOf(r: ReportArtifact): Sheet[] {
  const all = Object.values(r.charts || {}).filter((c) => c.type !== "kpi");
  let n = 0;
  const v = (cs: ChartArtifact[]) => cs.map((c) => {
    const out = vary(c, n++);
    const lost = out.annotations?.length ? [] : (c.annotations || []).filter((a) => a.label).map((a) => a.label);
    return lost.length ? { ...out, subtitle: [out.subtitle, "Marked: " + lost.join(" · ")].filter(Boolean).join(" — ") } : out;
  });
  const overview: Sheet = { key: "overview", name: "Overview", intro: r.exec?.takeaway || r.summary, kpis: r.exec?.kpis?.slice(0, 4),
    charts: v(all.filter((c) => c.type !== "table").slice(0, 4)), so_what: r.exec?.so_what };
  const topics = (r.sections || []).map((s, i) => ({
    key: `s${i + 1}`, name: short(s.title || s.heading || s.question || `Topic ${i + 1}`), intro: s.takeaway, kpis: s.kpis?.slice(0, 3),
    charts: v(s.chart_ids.map((id) => r.charts[id]).filter(Boolean)), so_what: s.so_what,
  })).filter((s) => s.charts.length);
  return [overview, ...topics];
}

function Kpis({ items }: { items?: { value: string; label: string; context: string; tone: string }[] }) {
  if (!items?.length) return null;
  return <div className="rp-kpis">{items.map((k, i) => (
    <div key={i} className={"rp-kpi t-" + k.tone}><span>{k.label}</span><b>{k.value}</b>{k.context && <em>{k.context}</em>}</div>))}</div>;
}

export default function Showcase() {
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  const [files, setFiles] = useState<Record<number, ReportFile>>({});
  const [pick, setPick] = useState<string>(() => (location.hash.slice(1).split("/")[0] || ""));
  const [sheet, setSheet] = useState<string>(() => (location.hash.slice(1).split("/")[1] || "overview"));
  useEffect(() => { loadIndex().then(setCards); }, []);
  useEffect(() => {   // back/forward and shared links: #property/s2
    const on = () => { const [a, b] = location.hash.slice(1).split("/"); setPick(a || ""); setSheet(b || "overview"); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const latest = useMemo(() => latestPerAnalyst(cards || []), [cards]);
  const card = latest.find((c) => c.industry === pick) || latest[0];
  useEffect(() => { if (card && !files[card.id]) loadReport(card.id).then((f) => f && setFiles((m) => ({ ...m, [card.id]: f }))); },
    [card]);  // eslint-disable-line react-hooks/exhaustive-deps
  const f = card ? files[card.id] : undefined;
  const sheets = useMemo(() => (f ? sheetsOf(f.report) : []), [f]);
  const cur = sheets.find((s) => s.key === sheet) || sheets[0];
  const [flt, setFlt] = useState<Filters>(ALL);
  useEffect(() => setFlt(ALL), [card?.industry, cur?.key]);
  const dims = useMemo(() => (cur ? dimensions(cur.charts) : []), [cur]);
  const views = useMemo(() => (cur ? cur.charts.map((c) => applyFilters(c, flt)) : []), [cur, flt]);
  const shownCharts = views.map((v) => v.chart);
  const go = (ind: string, sh = "overview") => { setPick(ind); setSheet(sh); history.replaceState(null, "", `#${ind}/${sh}`); };

  if (cards === null) return <p className="muted">Loading the sample dashboards…</p>;
  if (!latest.length) return null;
  const label = card ? monthLabel(card.period, card.month_to_date) : "";
  return (
    <section className="sc">
      <div className="sc-head">
        <div><span className="tag">Sample dashboards</span><h1>Every analyst keeps a live dashboard</h1>
          <p className="muted">Shown here on public South African market data. Clients get theirs on their own data, refreshed every morning,
            and can pin any chart from Ask AI.</p></div>
      </div>
      <nav className="sc-analysts" aria-label="Analyst">
        {latest.map((c) => <button key={c.industry} className={c.industry === card?.industry ? "on" : ""} onClick={() => go(c.industry)}>
          {ANALYSTS[c.industry]?.name || c.analyst}</button>)}
      </nav>
      {!f || !cur ? <p className="muted">Loading…</p> : (
        <div className="sc-book">
          <div className="sc-sheets" role="tablist" aria-label="Sheets">
            {sheets.map((s) => <button key={s.key} role="tab" aria-selected={s.key === cur.key} className={s.key === cur.key ? "on" : ""}
              onClick={() => go(card!.industry, s.key)} title={s.name}>{s.name}<em>{s.charts.length}</em></button>)}
          </div>
          <div className="sc-sheet" key={card!.industry + cur.key}>
            <div className="rp-board-head"><h3>{ANALYSTS[card!.industry]?.name} · {cur.name}</h3><span className="muted small">{label}</span>
              <a className="link" href={url(ANALYSTS[card!.industry]?.ask || "/analyst/")}>Open in Ask AI →</a></div>
            {cur.intro && <p className="sc-intro">{cur.intro}</p>}
            {(dims.length > 0 || views.some((v) => v.timed)) && <FilterBar f={flt} set={setFlt} dims={dims} base={ALL} />}
            <Kpis items={cur.kpis} />
            {cur.key === "overview" && (
              <KeyInsights items={keyInsights(shownCharts, 4)} label={label}
                ask={<AskBar industry={card!.industry} suggestions={["What stands out here?", "Is this good or bad news?", "What should I do about it?"]}
                  context={() => viewContext(`${ANALYSTS[card!.industry]?.name} dashboard, ${cur.name} sheet (${label})`, flt,
                    views, keyInsights(shownCharts, 4))} />} />
            )}
            <div className="rp-tiles sc-tiles">{views.map(({ chart: ch, note }) => (
              <div key={ch.id} className={"rp-tile" + (ch.type === "table" || ch.type === "line" || ch.type === "area" ? " wide" : "")}>
                <h4>{ch.title}</h4>{ch.subtitle && <p className="muted small">{ch.subtitle}</p>}
                {note && <p className="muted small">Showing the {note}.</p>}
                {(() => { const off = Object.entries(flt.dims).filter(([col, v]) => v && !ch.columns.some((x) => x.toLowerCase() === col.toLowerCase())).map(([col]) => col);
                  return off.length ? <p className="muted small">Not affected by the {off.join(" and ")} filter (this chart has no {off.join(" or ")}).</p> : null; })()}
                {!ch.rows.length ? <p className="muted small sc-empty">Nothing in this chart matches the filter.</p> : <ChartBlock c={ch} height={["hbar", "lollipop", "stacked"].includes(ch.type) ? Math.max(260, Math.min(560, ch.rows.length * 22 + 70))
                  : ch.type === "radial" || ch.type === "donut" ? 300 : 280} />}</div>))}</div>
            {cur.so_what && <div className="sc-sowhat"><b>So what</b><span>{cur.so_what}</span></div>}
          </div>
        </div>
      )}
    </section>
  );
}
