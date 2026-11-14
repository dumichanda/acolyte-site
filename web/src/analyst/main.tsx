import { createContext, StrictMode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactECharts from "../Chart";
import "../index.css";
import "./analyst.css";
import PlatformNav from "../PlatformNav";
import { url } from "../site";
import { readTheme } from "../charts";
import { chartOption, download, fmt, toCSV, type Artifact, type ChartArtifact, type ReportArtifact } from "./chart";

const exporter = () => import("./export");

/** Runs an export with a busy label on the button. */
function ExportBtn({ label, run, primary }: { label: string; run: () => Promise<void>; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <button className={"btn sm" + (primary ? " primary" : "")} disabled={busy}
    onClick={async () => { setBusy(true); try { await run(); } catch (e) { alert("Export failed: " + (e as Error).message); } finally { setBusy(false); } }}>
    {busy ? "Preparing…" : label}</button>;
}

import { API, api, getToken, logout, type Industry, type Me } from "../auth";
import { SignIn, UsageCard } from "../Account";
import { loadIndex, loadReport, monthLabel, type ReportCard } from "../reports/data";

/** Fills the empty canvas: this analyst's latest monthly reports, opened straight into the canvas. */
function LatestReports({ industry, onOpen }: { industry: string; onOpen: (r: ReportArtifact) => void }) {
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => { loadIndex().then((rs) => setCards(rs.filter((r) => r.industry === industry).slice(0, 4))); }, [industry]);
  if (!cards.length) return (
    <div className="latest-reports empty">
      <b>Monthly reports</b>
      <p className="muted small">This analyst publishes a report pack on the 1st of every month. It will appear here, ready to open and download.</p>
      <a className="link" href={url("/reports/")}>Reports &amp; dashboards →</a>
    </div>
  );
  return (
    <div className="latest-reports">
      <div className="lr-head"><b>Latest reports from this analyst</b><a className="link" href={url("/reports/")}>See all →</a></div>
      {cards.map((r) => (
        <button key={r.id} className="lr" disabled={busy === r.id} onClick={async () => {
          setBusy(r.id); const f = await loadReport(r.id); setBusy(null); if (f) onOpen(f.report);
        }}>
          <span className="muted small">{monthLabel(r.period, r.month_to_date)}</span>
          <b>{r.title}</b>
          {r.takeaway && <span className="muted small">{r.takeaway.length > 160 ? r.takeaway.slice(0, 157) + "…" : r.takeaway}</span>}
          <span className="go">{busy === r.id ? "Opening…" : "Open the report →"}</span>
        </button>
      ))}
    </div>
  );
}

/** Signed-in account (null = anonymous demo visitor). */
const AuthCtx = createContext<Me | null>(null);

interface Conv { id: string; title: string; updated_at: string; industry?: string; items?: unknown[]; artifacts?: Record<string, unknown> }
const LOCAL_HISTORY = "analystHistory";
const readLocal = (): Conv[] => { try { return JSON.parse(localStorage.getItem(LOCAL_HISTORY) || "[]"); } catch { return []; } };
const writeLocal = (xs: Conv[]) => {
  for (let n = xs.length; n > 0; n -= 5) {   // drop the oldest chats if browser storage is full
    try { localStorage.setItem(LOCAL_HISTORY, JSON.stringify(xs.slice(0, n))); return; } catch { /* quota */ }
  }
};

/** "Pin to dashboard": saves the chart's query so the dashboard re-runs it live. */
function PinButton({ c }: { c: ChartArtifact }) {
  const me = useContext(AuthCtx);
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<{ id: number; name: string; tiles: number }[] | null>(null);
  const [msg, setMsg] = useState("");
  if (!me || !c.sql) return null;
  const pin = async (id: number) => {
    try { await api(`/dashboards/${id}/tiles`, { body: { spec: c } }); setMsg("Pinned ✓"); setOpen(false); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <span className="pin">
      <button className="btn sm" onClick={async () => {
        setOpen(!open); setMsg("");
        if (!open) setBoards((await api<{ dashboards: { id: number; name: string; tiles: number }[] }>("/dashboards")).dashboards);
      }}>{msg === "Pinned ✓" ? "Pinned ✓" : "Pin"}</button>
      {open && (
        <div className="pin-menu">
          <div className="muted small">Pin to dashboard</div>
          {boards === null && <div className="muted small">Loading…</div>}
          {boards?.map((b) => <button key={b.id} onClick={() => pin(b.id)}>{b.name} <span className="muted">({b.tiles})</span></button>)}
          <button onClick={async () => {
            const name = prompt("Name for the new dashboard", "My dashboard");
            if (!name) return;
            try { const d = await api<{ id: number }>("/dashboards", { body: { name } }); await pin(d.id); }
            catch (e) { setMsg((e as Error).message); }
          }}>+ New dashboard…</button>
          {msg && msg !== "Pinned ✓" && <div className="err">{msg}</div>}
        </div>
      )}
    </span>
  );
}

/** Industry workspaces: what the analyst covers, how the page introduces it, and where to start. */
type Analyst = Exclude<Industry, "all">;
interface Skill { name: string; ask: string }
const WORKSPACES: Record<Analyst, { label: string; name: string; sub: string; placeholder: string; starters: string[]; skills: Skill[]; brief?: string }> = {
  jobs: {
    label: "Jobs & talent", name: "Acolyte Talent Analyst", placeholder: "Ask about South Africa's job market…",
    sub: "Your AI analyst for SA hiring: roles, skills, employers, salaries and automation potential, from live job ads.",
    starters: [
      "What changed in SA hiring this week compared with last week?",
      "Which roles are SA employers hiring for most this month?",
      "Compare Gauteng and Western Cape: roles, salaries and hiring trend",
      "Which skills and software do finance job ads ask for most?",
      "Which role types have the most automatable work, and where?",
      "Make me a report pack on the SA job market",
    ],
    skills: [
      { name: "Labour market scan", ask: "Run a labour market scan for bookkeeping and accounts admin roles in South Africa." },
      { name: "Salary benchmark", ask: "Benchmark salaries for creditors clerks: national and by province, with a recommended pay band." },
      { name: "Skills & tools demand", ask: "Which skills and tools do payroll job ads ask for most? Split must-have from nice-to-have." },
      { name: "Competitor hiring watch", ask: "Compare what the top 5 direct employers are hiring for, with their Glassdoor ratings." },
      { name: "Location strategy", ask: "Where should we hire a 20-person finance admin team: Gauteng, Western Cape or KwaZulu-Natal?" },
    ],
  },
  property: {
    label: "Property", name: "Acolyte Property Analyst", placeholder: "Ask about SA property: stock, prices, rents, agencies…",
    sub: "Your AI analyst for SA property: stock, asking prices, rents, yields, price cuts and agency share, refreshed every morning.",
    starters: [
      "What changed in the property market since yesterday?",
      "Where is residential stock for sale highest, by region?",
      "Median rent vs asking price by region: where are gross yields highest?",
      "Which agencies hold the most listings in Johannesburg, Cape Town and Durban?",
      "Where are sellers cutting asking prices?",
      "Make me a report pack on the Gauteng property market for an agency principal",
    ],
    skills: [
      { name: "Market conditions", ask: "Run a market conditions report for Johannesburg: is it leaning buyer's or seller's?" },
      { name: "CMA for a listing", ask: "Do a comparative market analysis for a 3-bedroom house in Centurion: what should it list for?" },
      { name: "Rental yield screen", ask: "Screen regions for buy-to-let: where are 2-bedroom gross yields highest versus the bond rate?" },
      { name: "Agency market share", ask: "Show agency market share in Cape Town, Durban and Pretoria." },
      { name: "Price-cut watch", ask: "Where are sellers cutting asking prices most, and which listings had the biggest cuts?" },
    ],
    brief: "Daily Property Brief",
  },
  retail: {
    label: "Retail pricing", name: "Acolyte Retail Pricing Analyst", placeholder: "Ask about SA shelf prices, retailers, baskets…",
    sub: "Your AI pricing analyst for FMCG: everyday-item prices across SA grocery chains, wholesalers, pharmacies and marketplaces, checked every morning.",
    starters: [
      "Which prices moved since yesterday, and which look like promotions?",
      "Which retailer is cheapest for a like-for-like basket today?",
      "Where are the widest price gaps between retailers for the same item?",
      "Compare Makro, Woolworths and Checkers Sixty60 on pantry staples",
      "Which channel is cheapest: grocery, wholesale, pharmacy or online?",
      "Make me a retail pricing report pack for a category manager",
    ],
    skills: [
      { name: "Price index", ask: "Build a price index for each retailer versus Makro on the items they both price." },
      { name: "Basket comparison", ask: "Compare the cost of a like-for-like basket across retailers today." },
      { name: "Price ladder", ask: "Show the price ladder for household cleaning items across retailers." },
      { name: "Promotion watch", ask: "Which retailers moved prices the most, and which moves look like promotions?" },
      { name: "Channel gaps", ask: "How do prices differ by channel: wholesale, grocery, pharmacy, quick commerce and marketplaces?" },
    ],
    brief: "Daily Retail Price Brief",
  },
  marketplace: {
    label: "Marketplaces", name: "Acolyte Marketplace Analyst", placeholder: "Ask about Amazon.co.za and Takealot prices…",
    sub: "Your AI analyst for SA online marketplaces: Amazon.co.za and Takealot prices, sellers and reviews against grocery and wholesale, every morning.",
    starters: [
      "What changed on Amazon.co.za and Takealot since yesterday?",
      "Is Amazon.co.za or Takealot cheaper on everyday items?",
      "How do marketplace prices compare with the cheapest grocery store?",
      "Which basket items are missing on Amazon.co.za or Takealot?",
      "Which marketplace sellers price above the rest?",
      "Make me a report pack on Amazon.co.za vs Takealot pricing",
    ],
    skills: [
      { name: "Head-to-head", ask: "Run an Amazon.co.za vs Takealot head-to-head on items both list." },
      { name: "Marketplace vs stores", ask: "Index marketplace prices against the cheapest grocery or wholesale price for the same item." },
      { name: "Assortment & coverage", ask: "Which basket items does each marketplace list, with ratings and review counts?" },
      { name: "Seller pricing", ask: "Where do third-party marketplace sellers price above the marketplace itself?" },
      { name: "Price moves", ask: "How often do marketplace prices move compared with grocery chains?" },
    ],
  },
};
const WS_KEY = "analystWorkspace";
const initialWorkspace = (): Analyst => {
  try {
    const q = new URLSearchParams(location.search).get("industry") as Analyst | null;
    if (q && q in WORKSPACES) { localStorage.setItem(WS_KEY, q); return q; }
    const v = localStorage.getItem(WS_KEY) as Analyst | null;
    return v && v in WORKSPACES ? v : "jobs";
  } catch { return "jobs"; }
};

interface Brief { day: string; status: string; report: ReportArtifact | null; summary: string | null; finished_at: string | null }
interface BriefResp { today: string; today_status: string | null; brief: Brief | null; history: { day: string; status: string; title: string | null }[] }

/** Today's industry brief for signed-in workspaces: opens in the canvas, downloads as the 5-slide executive pack. */
function BriefCard({ industry, onOpen }: { industry: Analyst; onOpen: (r: ReportArtifact) => void }) {
  const me = useContext(AuthCtx);
  const [b, setB] = useState<BriefResp | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!me || !WORKSPACES[industry].brief) return;
    let stop = false, timer = 0;
    const load = () => api<BriefResp>(`/briefs/${industry}`).then((r) => {
      if (stop) return;
      setB(r); setErr("");
      if (r.today_status === "running") timer = window.setTimeout(load, 30000);
    }).catch((e) => !stop && setErr((e as Error).message));
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [me, industry]);
  const title = WORKSPACES[industry].brief;
  if (!title) return null;
  if (!me) return <div className="brief-card"><b>{title}</b><p className="muted small">Sign in to get a fresh brief every morning, ready as a 5-slide PowerPoint.</p></div>;
  if (err) return null;
  const r = b?.brief?.status === "ready" ? b.brief.report : null;
  const isToday = b?.brief?.day === b?.today;
  return (
    <div className="brief-card">
      <div className="brief-head"><b>{title}</b>
        {b?.today_status === "running" && <span className="pill run">Preparing today's brief…</span>}
        {r && <span className="pill">{isToday ? "Today" : new Date(b!.brief!.day).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}</span>}
      </div>
      {r ? <>
        <p>{r.exec?.takeaway || r.summary || r.title}</p>
        <div className="row"><button className="btn primary sm" onClick={() => onOpen(r)}>Open the brief</button>
          <ExportBtn label="Executive PowerPoint" run={async () => (await exporter()).reportToPptx(r, "executive")} /></div>
      </> : <p className="muted small">{b?.today_status === "running" ? "Your analyst is writing this morning's brief from today's data. It takes about three minutes; this card updates itself."
        : "The first brief is written after the morning data refresh (from 07:00)."}</p>}
    </div>
  );
}

interface Dataset { id: string; title: string; sql: string; columns: string[]; rows: unknown[][]; row_count: number }
type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; status: string[]; queries: Dataset[]; artifacts: string[]; error?: string; done: boolean; usage?: Usage };

interface Usage { tier: string; models: string[]; cost_usd: number; tokens: { input: number; cache_read: number; cache_write: number; output: number } }
const MODEL_NAME: Record<string, string> = { "claude-haiku-5-5": "Haiku 5.5", "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };
function UsageLine({ u }: { u: Usage }) {
  const t = u.tokens, total = t.input + t.cache_read + t.cache_write + t.output;
  const cost = u.cost_usd < 0.01 ? `${(u.cost_usd * 100).toFixed(2)} US cents` : `$${u.cost_usd.toFixed(3)}`;
  return <div className="usage" title={`input ${t.input} / cached ${t.cache_read} / cache write ${t.cache_write} / output ${t.output} tokens`}>
    {u.models.map((m) => MODEL_NAME[m] ?? m).join(" then ")} · {cost} · {(total / 1000).toFixed(1)}k tokens ({Math.round(100 * t.cache_read / Math.max(total, 1))}% cached)
  </div>;
}

/** Tiny, safe markdown: paragraphs, - bullets, **bold**. Everything is escaped first. */
function Md({ text }: { text: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l)))
          return <ul key={i}>{lines.map((l, j) => <li key={j} dangerouslySetInnerHTML={{ __html: inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, "")) }} />)}</ul>;
        return <p key={i} dangerouslySetInnerHTML={{ __html: lines.map(inline).join("<br/>") }} />;
      })}
    </>
  );
}

function useTheme() {
  const [t, setT] = useState<ReturnType<typeof readTheme> | null>(null);
  useEffect(() => setT(readTheme()), []);
  return t;
}

function ChartView({ c, height = 340, print = false }: { c: ChartArtifact; height?: number; print?: boolean }) {
  const t = useTheme();
  const ref = useRef<any>(null);
  if (!t) return null;
  const pt = print ? { ink: "#16140f", muted: "#6b6656", line: "#e7e2d6", panel: "#ffffff" } : t;
  const csv = () => download(`${c.title}.csv`, toCSV(c), "text/csv");
  const png = () => {
    const inst = ref.current?.getEchartsInstance();
    if (inst) download(`${c.title}.png`, inst.getDataURL({ pixelRatio: 2, backgroundColor: "#141417" }), "image/png");
  };
  let body;
  if (c.type === "kpi") {
    const yi = c.columns.indexOf(c.y[0]);
    body = <div className="kpi-art"><div className="v">{fmt(c.rows[0]?.[yi], c.value_format)}</div><div className="muted">{c.y[0]}</div></div>;
  } else if (c.type === "table") {
    const idx = [c.columns.indexOf(c.x), ...c.y.map((y) => c.columns.indexOf(y))].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
    body = (
      <div className="table-scroll" style={{ maxHeight: print ? "none" : 380 }}>
        <table><thead><tr>{idx.map((i) => <th key={i}>{c.columns[i]}</th>)}</tr></thead>
          <tbody>{c.rows.slice(0, print ? 25 : 200).map((r, k) => <tr key={k}>{idx.map((i) => <td key={i} className={typeof r[i] === "number" ? "num" : ""}>{typeof r[i] === "number" ? fmt(r[i], c.y.includes(c.columns[i]) ? c.value_format : "number") : String(r[i] ?? "—")}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  } else {
    body = <ReactECharts ref={ref} style={{ height }} option={chartOption(c, pt, print)} opts={print ? { renderer: "svg" } : undefined} {...(print ? { theme: "acolyte-light" } : {})} notMerge />;
  }
  return (
    <div className="art-chart">
      <div className="art-head">
        <div><h3>{c.title}</h3>{c.subtitle && <div className="muted small">{c.subtitle}</div>}</div>
        {!print && <div className="art-actions">
          {c.type !== "table" && c.type !== "kpi" && <button className="btn sm" onClick={png}>PNG</button>}
          <button className="btn sm" onClick={csv}>CSV</button>
          <ExportBtn label="PPT" run={async () => (await exporter()).chartsToPptx([c])} />
          <PinButton c={c} />
        </div>}
      </div>
      {body}
      {!print && <details className="sql"><summary>How this was calculated</summary><pre>{c.sql}</pre></details>}
    </div>
  );
}

function KpiCards({ items }: { items?: { value: string; label: string; context: string; tone: string }[] }) {
  if (!items?.length) return null;
  return <div className="kcards">{items.map((k, i) => (
    <div key={i} className={"kcard t-" + k.tone}><span>{k.label}</span><b>{k.value}</b><em>{k.context}</em></div>))}</div>;
}

/** Slide count of the full pack (mirrors deck.ts buildDeck). */
const fullSlides = (r: ReportArtifact) => 1 + (r.exec?.takeaway || r.exec?.kpis?.length || r.summary ? 1 : 0) + r.sections.length
  + (r.qa?.length ? 1 : 0) + (r.conclusions?.findings?.length || r.conclusions?.actions?.length ? 1 : 0)
  + (r.method?.steps?.length || r.method?.limits?.length ? 1 : 0) + 1;

function ReportView({ r, actions = true }: { r: ReportArtifact; actions?: boolean }) {
  const ex = r.exec;
  return (
    <div className="report-art">
      <div className="art-head">
        <div><span className="tag">Report pack</span><h2>{r.title}</h2>
          <div className="muted small">{r.scope ? r.scope + " · " : ""}Acolyte Analyst · {new Date(r.generated).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</div></div>
        {actions && <div className="dl-groups">
          <div className="dl"><span>Executive · {Math.min(2, r.sections.length) + 3} slides</span>
            <ExportBtn label="PowerPoint" primary run={async () => (await exporter()).reportToPptx(r, "executive")} />
            <ExportBtn label="PDF" run={async () => (await exporter()).reportToPdf(r, "executive")} /></div>
          <div className="dl"><span>Full pack · {fullSlides(r)} slides</span>
            <ExportBtn label="PowerPoint" run={async () => (await exporter()).reportToPptx(r, "standard")} />
            <ExportBtn label="PDF" run={async () => (await exporter()).reportToPdf(r, "standard")} /></div>
        </div>}
      </div>
      {ex?.takeaway ? (<>
        <h3 className="rtitle">{ex.title}</h3>
        <p className="lead">{ex.takeaway}</p>
        <KpiCards items={ex.kpis} />
        <div className="boxes">
          {ex.so_what && <div className="box so"><b>So what</b><p>{ex.so_what}</p></div>}
          {ex.catch && <div className="box note"><b>The catch</b><p>{ex.catch}</p></div>}
        </div>
      </>) : <p className="lead">{r.summary}</p>}
      {r.sections.map((s, i) => (
        <section key={i}>
          {s.question && <div className="qtag"><span>Q{i + 1}</span>{s.question}</div>}
          <h3>{s.title || s.heading}</h3>
          {s.takeaway && <p className="take">{s.takeaway}</p>}
          <KpiCards items={s.kpis} />
          {s.chart_ids.map((id) => r.charts[id] && <ChartView key={id} c={r.charts[id]} height={280} print={!actions} />)}
          <div className="boxes">
            {s.so_what && <div className="box so"><b>So what</b><p>{s.so_what}</p></div>}
            {s.note && <div className="box note"><b>How to read it</b><p>{s.note}</p></div>}
          </div>
          {s.bullets?.length ? <ul>{s.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul> : !s.takeaway && <Md text={s.body} />}
        </section>
      ))}
      {r.qa?.length ? <section><h3>Executive Q&A</h3><div className="qa">{r.qa.map((x, i) => <div key={i}><b>{x.q}</b><p>{x.a}</p></div>)}</div></section> : null}
      {r.conclusions?.actions?.length ? <section><h3>Recommended actions</h3><ol>{r.conclusions.actions.map((a, i) => <li key={i}>{a}</li>)}</ol></section> : null}
      <div className="muted small foot">Source: Acolyte, {dataSourceLabel(r)} (refreshed daily). Download the pack for the full method and limits.</div>
    </div>
  );
}

function dataSourceLabel(r: ReportArtifact) {
  const sql = Object.values(r.charts || {}).map((c) => c.sql || "").join(" ");
  if (/retail_/.test(sql)) return "SA retail price dataset (Google Shopping South Africa)";
  const p = /property_|bond_rate/.test(sql), j = /\b(jobs|job_tools|job_skills|employers|daily_stats|salary_benchmarks)\b/.test(sql);
  return p && j ? "SA jobs and property datasets" : p ? "SA property dataset (Private Property listings)" : "SA jobs dataset (public job ads)";
}

function Voice({ onText }: { onText: (t: string) => void }) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const [on, setOn] = useState(false);
  if (!SR) return null;
  const start = () => {
    const rec = new SR();
    rec.lang = "en-ZA"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => onText(e.results[0][0].transcript);
    rec.onend = () => setOn(false);
    rec.onerror = () => setOn(false);
    setOn(true); rec.start();
  };
  return <button className={"mic" + (on ? " on" : "")} onClick={start} title="Ask by voice" aria-label="Ask by voice">{on ? "● Listening" : "🎙"}</button>;
}

interface DataCol { name: string; original: string; type: string; examples?: string[]; min?: string; max?: string; place?: boolean }
interface DataTable { id: number; table_name: string; display_name: string; row_count: number; columns: DataCol[]; description: string | null;
  source?: string; source_url?: string | null; last_synced?: string | null; sync_error?: string | null }

/** The client's own data: upload CSV/Excel into their private area, describe it, and ask across it and the market. */
function YourData({ onAsk, onChange }: { onAsk: (q: string) => void; onChange: (n: number) => void }) {
  const me = useContext(AuthCtx);
  const [tables, setTables] = useState<DataTable[]>([]);
  const [limit, setLimit] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [dup, setDup] = useState<File | null>(null);
  const [del, setDel] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [robot, setRobot] = useState<string | null>(null);
  const [sheet, setSheet] = useState("");
  const [showSheet, setShowSheet] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api<{ tables: DataTable[]; limit: number; sheets_email: string | null }>("/data");
      setTables(r.tables); setLimit(r.limit); setRobot(r.sheets_email); onChange(r.tables.length);
    }
    catch { /* signed out */ }
  }, [onChange]);
  useEffect(() => { if (me) load(); }, [me, load]);
  if (!me) return null;

  const send = async (f: File, replace = false) => {
    setBusy(true); setMsg(""); setDup(null);
    const fd = new FormData(); fd.append("file", f); fd.append("replace", String(replace));
    try {
      const r = await fetch(`${API}/data/upload`, { method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409) { setDup(f); setMsg(d.detail); return; }
      if (!r.ok) throw new Error(d.detail || r.statusText);
      setMsg(`Loaded ${d.rows.toLocaleString("en-ZA")} rows into ${d.name}. Check the columns below and add a short description.`);
      await load();
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const connect = async (replace = false) => {
    setBusy(true); setMsg(""); setDup(null);
    try {
      const d = await api<{ rows: number; name: string }>("/data/sheet", { body: { url: sheet.trim(), replace } });
      setMsg(`Connected: ${d.rows.toLocaleString("en-ZA")} rows in ${d.name}. It re-syncs every morning.`); setSheet(""); setShowSheet(false);
      await load();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409) { setMsg(err.message); setDup(new File([], "__sheet__")); } else setMsg(err.message);
    } finally { setBusy(false); }
  };
  const sync = async (id: number) => {
    setBusy(true); setMsg("");
    try { const d = await api<{ rows: number }>(`/data/${id}/sync`, { method: "POST" }); setMsg(`Synced: ${d.rows.toLocaleString("en-ZA")} rows.`); await load(); }
    catch (e) { setMsg((e as Error).message); await load(); } finally { setBusy(false); }
  };
  return (
    <details className="your-data" open>
      <summary>Your data <span className="muted">({tables.length}/{limit})</span></summary>
      <p className="muted small">Upload a CSV or Excel file. It stays private to your account, and your analyst can compare it with the market.</p>
      <label className={"btn sm upload" + (busy ? " busy" : "")}>
        {busy ? "Uploading…" : "Upload CSV or Excel"}
        <input ref={fileRef} type="file" id="data-upload" accept=".csv,.txt,.xlsx,.xlsm" hidden disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }} />
      </label>
      <button className="btn sm" onClick={() => setShowSheet(!showSheet)} disabled={busy}>Connect a Google Sheet</button>
      {showSheet && (
        <form className="sheet-form" onSubmit={(e) => { e.preventDefault(); if (sheet.trim()) connect(); }}>
          <label htmlFor="sheet-url" className="small muted">Paste the sheet's link (the first tab is used, or the tab open in the link).</label>
          <input id="sheet-url" value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          <p className="small muted">{robot
            ? <>Share the sheet with <code className="robot">{robot}</code> as Viewer first. It stays private.</>
            : <>Set the sheet's sharing to "Anyone with the link can view". Anyone with the link could then open it, so use this for non-sensitive data.</>}</p>
          <button className="btn sm primary" disabled={busy || !sheet.trim()}>{busy ? "Connecting…" : "Connect"}</button>
        </form>
      )}
      {msg && <div className="small data-msg">{msg}
        {dup && <div className="row"><button className="btn sm" onClick={() => (dup.name === "__sheet__" ? connect(true) : send(dup, true))}>Replace it</button>
          <button className="btn sm" onClick={() => { setDup(null); setMsg(""); }}>Cancel</button></div>}</div>}
      {tables.map((t) => (
        <div key={t.id} className="dt">
          <button className="dt-head" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
            <b>{t.source === "google_sheet" ? "▦ " : ""}{t.display_name}</b>
            <em>{t.row_count.toLocaleString("en-ZA")} rows · {t.columns.length} columns
              {t.source === "google_sheet" && t.last_synced ? ` · synced ${new Date(t.last_synced).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : ""}</em>
            {t.sync_error && <em className="sync-err">Last sync failed: {t.sync_error}</em>}
          </button>
          {open === t.id && (
            <div className="dt-body">
              <table><tbody>{t.columns.map((c) => (
                <tr key={c.name}><td><code>{c.name}</code>{c.place && <span className="tag">place</span>}</td><td className="muted">{c.type}</td>
                  <td className="muted">{c.min ? `${c.min} … ${c.max}` : (c.examples || []).join(", ")}</td></tr>))}</tbody></table>
              <DescribeBox t={t} onSaved={load} />
              <div className="row">
                <button className="btn sm primary" onClick={() => onAsk(`Give me an overview of my ${t.display_name} data: what's in it, the main totals and anything unusual.`)}>Explore it</button>
                <button className="btn sm" onClick={() => onAsk(`Compare my ${t.display_name} data with the market data. Where do we stand?`)}>Compare with market</button>
                {t.source === "google_sheet" && <button className="btn sm" disabled={busy} onClick={() => sync(t.id)}>Sync now</button>}
                {del === t.id
                  ? <><button className="btn sm danger" onClick={async () => { await api(`/data/${t.id}`, { method: "DELETE" }).catch(() => {}); setDel(null); load(); }}>Yes, delete</button>
                      <button className="btn sm" onClick={() => setDel(null)}>Keep</button></>
                  : <button className="btn sm" onClick={() => setDel(t.id)}>Delete</button>}
              </div>
            </div>
          )}
        </div>
      ))}
    </details>
  );
}

function DescribeBox({ t, onSaved }: { t: DataTable; onSaved: () => void }) {
  const [v, setV] = useState(t.description || "");
  const [saved, setSaved] = useState(false);
  return (
    <form className="describe" onSubmit={async (e) => { e.preventDefault(); await api(`/data/${t.id}`, { method: "PATCH", body: { description: v } }); setSaved(true); onSaved(); }}>
      <label htmlFor={`desc-${t.id}`} className="small muted">What is this table? (helps your analyst)</label>
      <textarea id={`desc-${t.id}`} rows={2} value={v} placeholder="e.g. Our active sale mandates, exported from our CRM on 14 Nov"
        onChange={(e) => { setV(e.target.value); setSaved(false); }} />
      <button className="btn sm" disabled={saved}>{saved ? "Saved" : "Save description"}</button>
    </form>
  );
}

function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, Artifact>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<"checking" | "ok" | "down" | "unconfigured">(API ? "checking" : "unconfigured");
  const [speak, setSpeak] = useState(false);
  const [mode, setMode] = useState<"auto" | "fast" | "standard" | "deep">("auto");
  const session = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [history, setHistory] = useState<Conv[]>([]);
  const [sideOpen, setSideOpen] = useState(false);
  const [pick, setPick] = useState<Analyst>(initialWorkspace);
  const [myTables, setMyTables] = useState(0);
  const own = me?.account.industry;
  const locked: Analyst | null = own && own !== "all" && own in WORKSPACES ? (own as Analyst) : null;
  const ws: Analyst = locked || pick;
  const W = WORKSPACES[ws];
  const wsRef = useRef(ws); wsRef.current = ws;
  const choose = (v: Analyst) => { setPick(v); try { localStorage.setItem(WS_KEY, v); } catch { /* storage blocked */ } reset(); };
  const openReport = (r: ReportArtifact) => {
    setArtifacts((m) => ({ ...m, [r.id]: r })); setOrder((o) => [r.id, ...o.filter((x) => x !== r.id)]); setActive(r.id);
  };

  const localFor = (a: Analyst) => readLocal().filter((c) => (c.industry || "jobs") === a);
  const refreshAccount = useCallback(async () => {
    const a = wsRef.current;
    if (!getToken()) { setMe(null); setHistory(localFor(a)); return; }
    try {
      const m = await api<Me>("/me");
      setMe(m);
      const own = m.account.industry && m.account.industry !== "all" ? m.account.industry : a;
      setHistory((await api<{ conversations: Conv[] }>(`/conversations?industry=${own}`)).conversations);
    } catch { setMe(null); setHistory(localFor(a)); }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refreshAccount(); }, [refreshAccount, ws]);

  // Anonymous visitors: keep chats in this browser.
  useEffect(() => {
    if (busy || me || !session.current || !items.length) return;
    const first = items.find((i) => i.kind === "user") as { text: string } | undefined;
    const entry: Conv = { id: session.current, title: first?.text ?? "Chat", updated_at: new Date().toISOString(), industry: ws, items, artifacts };
    const next = [entry, ...readLocal().filter((c) => c.id !== entry.id)].slice(0, 25);
    writeLocal(next); setHistory(next.filter((c) => (c.industry || "jobs") === ws));
  }, [busy]);  // eslint-disable-line react-hooks/exhaustive-deps

  const openConversation = async (id: string) => {
    if (busy) return;
    let c: Conv | undefined;
    try { c = me ? await api<Conv>(`/conversations/${id}`) : readLocal().find((x) => x.id === id); }
    catch { return; }
    if (!c) return;
    const its = ((c.items || []) as Item[]).map((it) => (it.kind === "assistant" ? { ...it, done: true } : it));
    const arts = (c.artifacts || {}) as Record<string, Artifact>;
    const ids = its.flatMap((it) => (it.kind === "assistant" ? it.artifacts : []));
    session.current = id; setItems(its); setArtifacts(arts);
    setOrder([...ids].reverse()); setActive(ids.length ? ids[ids.length - 1] : null); setSideOpen(false);
  };
  const deleteConversation = async (id: string) => {
    if (!confirm("Delete this chat?")) return;
    if (me) { await api(`/conversations/${id}`, { method: "DELETE" }).catch(() => {}); }
    else writeLocal(readLocal().filter((c) => c.id !== id));
    if (session.current === id) reset();
    refreshAccount();
  };

  useEffect(() => {
    if (!API) return;
    let tries = 0;
    const ping = () => fetch(`${API}/health`).then((r) => r.json()).then((h) => setHealth(h.ai && h.db ? "ok" : "unconfigured"))
      .catch(() => (++tries < 8 ? setTimeout(ping, 8000) : setHealth("down")));
    ping();
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [items]);

  const patchLast = (f: (a: Extract<Item, { kind: "assistant" }>) => void) =>
    setItems((xs) => { const ys = [...xs]; const last = { ...(ys[ys.length - 1] as any) }; f(last); ys[ys.length - 1] = last; return ys; });

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setQ(""); setBusy(true);
    setItems((xs) => [...xs, { kind: "user", text: question }, { kind: "assistant", text: "", status: [], queries: [], artifacts: [], done: false }]);
    let answerText = "";
    try {
      const token = getToken();
      const r = await fetch(`${API}/ask`, { method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ session_id: session.current, question, mode, industry: ws }) });
      if (!r.ok || !r.body) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        throw new Error(err.detail || "The analyst is unavailable.");
      }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "session") session.current = ev.session_id;
          else if (ev.type === "text") { answerText += ev.text; patchLast((a) => { a.text += ev.text; }); }
          else if (ev.type === "status") patchLast((a) => { a.status = [...a.status, ev.text]; });
          else if (ev.type === "query") patchLast((a) => { a.queries = [...a.queries, ev.dataset]; });
          else if (ev.type === "artifact") {
            const art = ev.artifact as Artifact;
            setArtifacts((m) => ({ ...m, [art.id]: art }));
            setOrder((o) => [art.id, ...o.filter((x) => x !== art.id)]);
            setActive(art.id);
            patchLast((a) => { a.artifacts = [...a.artifacts, art.id]; });
          } else if (ev.type === "error") patchLast((a) => { a.error = ev.text; });
          else if (ev.type === "usage") patchLast((a) => { a.usage = ev; });
          else if (ev.type === "done") patchLast((a) => { a.done = true; });
        }
      }
    } catch (e) {
      patchLast((a) => { a.error = (e as Error).message || "Connection lost."; });
    } finally {
      patchLast((a) => { a.done = true; });
      setBusy(false);
      if (getToken()) setTimeout(refreshAccount, 1200);   // usage rings + saved chat list
      if (speak && answerText && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(answerText.replace(/\*\*/g, "").replace(/^[-•]\s*/gm, ""));
        u.lang = "en-ZA"; speechSynthesis.cancel(); speechSynthesis.speak(u);
      }
    }
  }

  function reset() { session.current = null; setItems([]); setArtifacts({}); setOrder([]); setActive(null); setSideOpen(false); }
  const current = active ? artifacts[active] : null;
  const ready = health === "ok";
  const placeholder = useMemo(() => (ready ? W.placeholder : health === "checking" ? "Waking up the analyst (can take up to a minute)…" : "Analyst offline"), [ready, health, W]);

  return (
    <AuthCtx.Provider value={me}>
    <div className="wrap analyst">
      <PlatformNav active="/analyst/" />
      <button className="btn sm side-toggle" onClick={() => setSideOpen(!sideOpen)}>☰ Chats</button>
      <div className="an-grid with-side">
        <aside className={"side" + (sideOpen ? " open" : "")}>
          <button className="btn primary new-chat" onClick={reset} disabled={busy}>+ New chat</button>
          <div className="side-title">{me ? "Your chats" : "Chats on this device"}</div>
          <div className="history">
            {history.length === 0 && <div className="muted small">No chats yet.</div>}
            {history.map((c) => (
              <div key={c.id} className={"hist" + (c.id === session.current ? " on" : "")}>
                <button className="hist-open" onClick={() => openConversation(c.id)} title={c.title}>
                  <span>{c.title}</span><em>{new Date(c.updated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}</em>
                </button>
                <button className="hist-del" onClick={() => deleteConversation(c.id)} aria-label="Delete chat">×</button>
              </div>
            ))}
          </div>
          <YourData onAsk={(q) => { setSideOpen(false); ask(q); }} onChange={setMyTables} />
          <div className="side-account">
            {me ? <UsageCard me={me} onLogout={() => { logout(); reset(); refreshAccount(); }} />
              : <SignIn onDone={(m) => { setMe(m); reset(); refreshAccount(); }} />}
            {me && <a className="link" href="../dashboards/">Your dashboards →</a>}
          </div>
        </aside>
        <section className="chat">
          <header>
            {!locked && (
              <div className="ws-tabs" role="tablist" aria-label="Choose an analyst">
                {(Object.keys(WORKSPACES) as Analyst[]).map((k) => (
                  <button key={k} role="tab" aria-selected={k === ws} className={k === ws ? "on" : ""} disabled={busy} onClick={() => k !== ws && choose(k)}>
                    {WORKSPACES[k].name.replace("Acolyte ", "")}</button>
                ))}
              </div>
            )}
            <h1>{W.name}</h1>
            <p className="sub">{W.sub}</p>
          </header>
          {health === "unconfigured" && <div className="banner">The analyst service isn't connected yet. It runs as a small server (see <code>analyst/</code> in the repo). Once it's deployed, its address goes in <code>site.ts → analystApi</code>.</div>}
          {health === "down" && <div className="banner">The analyst isn't responding. Please try again shortly.</div>}

          <div className="thread">
            {items.length === 0 && <BriefCard industry={ws} onOpen={openReport} />}
            {items.length === 0 && (
              <div className="starters">
                <div className="muted small">Expert skills</div>
                <div className="skills">{W.skills.map((k) => <button key={k.name} className="skill" disabled={!ready} title={k.ask} onClick={() => ask(k.ask)}>{k.name}</button>)}</div>
                <div className="muted small">Or try one of these</div>
                {myTables > 0 && <button className="starter mine" disabled={!ready} onClick={() => ask("Compare my own data with the market data: where do we stand, and what should we do?")}>Compare my own data with the market</button>}
                {W.starters.map((s) => <button key={s} className="starter" disabled={!ready} onClick={() => ask(s)}>{s}</button>)}
              </div>
            )}
            {items.map((it, i) => it.kind === "user"
              ? <div key={i} className="msg user">{it.text}</div>
              : (
                <div key={i} className="msg bot">
                  {it.status.length > 0 && (
                    <div className="steps">
                      {it.status.map((s, k) => <span key={k} className={"step" + (k === it.status.length - 1 && !it.done ? " live" : "")}>{s}</span>)}
                    </div>
                  )}
                  {it.queries.length > 0 && (
                    <details className="queries"><summary>{it.queries.length} quer{it.queries.length > 1 ? "ies" : "y"} run</summary>
                      {it.queries.map((d) => (
                        <div key={d.id} className="q"><b>{d.title}</b> <span className="muted">· {d.row_count} rows</span>
                          <pre>{d.sql}</pre>
                          <button className="btn sm" onClick={() => download(`${d.title}.csv`, toCSV(d), "text/csv")}>Download CSV</button>
                        </div>
                      ))}
                    </details>
                  )}
                  {it.text ? <div className="answer"><Md text={it.text} /></div> : !it.done && !it.error && <div className="typing"><span /><span /><span /></div>}
                  {it.artifacts.length > 0 && (
                    <div className="chips">{it.artifacts.map((id) => artifacts[id] && (
                      <button key={id} className={"chip-art" + (active === id ? " on" : "")} onClick={() => setActive(id)}>
                        {artifacts[id].kind === "report" ? "▤ " : "▥ "}{artifacts[id].title}</button>))}</div>
                  )}
                  {it.error && <div className="err">{it.error}</div>}
                  {it.usage && <UsageLine u={it.usage} />}
                </div>
              ))}
            <div ref={endRef} />
          </div>

          <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <textarea rows={2} value={q} placeholder={placeholder} disabled={!ready}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }} />
            <div className="row">
              <Voice onText={(t) => ask(t)} />
              <label className="speak"><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Read aloud</label>
              <select className="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} title="Which AI model answers">
                <option value="auto">Auto model</option><option value="fast">Fast (Haiku)</option>
                <option value="standard">Balanced (Sonnet)</option><option value="deep">Deep (Opus)</option>
              </select>
              <span style={{ flex: 1 }} />
              {items.length > 0 && <button type="button" className="btn sm" onClick={reset}>New chat</button>}
              <button className="btn primary" disabled={!ready || busy || !q.trim()}>{busy ? "Thinking…" : "Ask"}</button>
            </div>
          </form>
          <p className="muted small">Built on public {ws === "property" ? "property listings" : ws === "jobs" ? "job ads" : "online retail prices"}. Answers can be wrong; check the queries. <a href={url("/#contact")}>Want this on your own data?</a></p>
        </section>

        <section className="canvas">
          {order.filter((id) => artifacts[id].kind === "chart").length > 1 && (
            <div className="export-all">
              <ExportBtn label="All charts → PowerPoint" run={async () => (await exporter()).chartsToPptx(
                order.map((id) => artifacts[id]).filter((a): a is ChartArtifact => a.kind === "chart").reverse())} />
            </div>
          )}
          {order.length > 1 && (
            <div className="tabs">{order.map((id) => (
              <button key={id} className={"tab" + (id === active ? " on" : "")} onClick={() => setActive(id)}>
                {artifacts[id].kind === "report" ? "▤ " : ""}{artifacts[id].title}</button>))}
            </div>
          )}
          {!current && (
            <>
              <div className="canvas-empty">
                <div className="big">Charts and reports appear here</div>
                <p className="muted">Each one is drawn from the live data, can be downloaded as PNG, CSV or PDF, and shows the query behind it.</p>
              </div>
              <LatestReports industry={ws} onOpen={openReport} />
            </>
          )}
          {current?.kind === "chart" && <div className="card"><ChartView c={current} /></div>}
          {current?.kind === "report" && <div className="card"><ReportView r={current} /></div>}
        </section>
      </div>
    </div>
    </AuthCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
