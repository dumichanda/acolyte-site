import { Fragment, StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./admin.css";
import ReactECharts from "../Chart";
import PlatformNav from "../PlatformNav";
import { SITE } from "../site";
import { CATEGORICAL, mode as themeMode } from "../viz";

// Private admin page: reads /admin/stats from the analyst API with the admin key (kept only in this browser).
const API = (() => {
  try { return (localStorage.getItem("analystApi") || SITE.analystApi).replace(/\/$/, ""); } catch { return SITE.analystApi; }
})();
const KEY_STORE = "acolyteAdminKey";
const TIER_NAME: Record<string, string> = { fast: "Fast (Haiku)", standard: "Balanced (Sonnet)", deep: "Deep (Opus)", unknown: "Not answered" };
const TIERS = ["fast", "standard", "deep"];
const ADZUNA_BUDGET = 4800;

const n = (v: unknown) => Number(v) || 0;
const usd = (v: unknown) => { const x = n(v); return x < 0.01 && x > 0 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`; };
const when = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const secs = (ms: unknown) => `${(n(ms) / 1000).toFixed(1)}s`;

interface Win { questions: number; visitors: number; sessions: number; cost_usd: string; errors: number; reports: number; charts: number; avg_ms: string; avg_cost: string; sql_queries: number }
interface Stats {
  generated: string; days: number;
  live_budget: { spent_usd: number; cap_usd: number; questions: number };
  windows: { today: Win; "7d": Win; period: Win };
  daily: { day: string; tier: string; questions: number; cost_usd: string; visitors: number }[];
  by_tier: { tier: string; questions: number; cost_usd: string; avg_cost: string; avg_ms: string }[];
  countries: { country: string; visitors: number; questions: number }[];
  recent: { id: number; at: string; country: string | null; question: string; mode: string; tier: string | null; models: string[] | null;
            status: string | null; error: string | null; queries: { title: string; sql: string; rows: number }[] | null; charts: number;
            report: boolean; cost_usd: string | null; input_tokens: number | null; cache_read_tokens: number | null;
            cache_write_tokens: number | null; output_tokens: number | null; duration_ms: number | null; visitor: string | null }[];
  pipeline: Record<string, number | string | null>;
  adzuna: { month: string; source: string; calls: number; results: number }[];
  agents: { id: number; agent: string; model: string; status: string; tool_calls: number; cost_usd: string; summary: string | null; error: string | null; started_at: string }[];
  agent_spend: { agent: string; runs: number; cost_usd: string }[];
  crm: { stage: string; opportunities: number; with_draft: number; emailed: number }[];
}

function KeyGate({ onKey, error }: { onKey: (k: string) => void; error: string }) {
  const [k, setK] = useState("");
  return (
    <div className="card gate">
      <span className="tag">Private</span>
      <h2>Admin</h2>
      <p className="muted">Enter the admin key (the <code>ADMIN_TOKEN</code> value set on the analyst service in Render). It is kept only in this browser.</p>
      <form onSubmit={(e) => { e.preventDefault(); onKey(k.trim()); }} className="toolbar">
        <input type="password" placeholder="Admin key" value={k} onChange={(e) => setK(e.target.value)} autoFocus />
        <button className="btn primary">Open</button>
      </form>
      {error && <div className="err">{error}</div>}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return <div className="kpi"><div className="label">{label}</div><div className={"value " + (tone || "")}>{value}</div>{hint && <div className="hint">{hint}</div>}</div>;
}

function Dashboard({ s }: { s: Stats }) {
  const [open, setOpen] = useState<number | null>(null);
  const cat = CATEGORICAL[themeMode()];
  const days = useMemo(() => [...new Set(s.daily.map((d) => d.day))].sort(), [s]);
  const p = s.windows.period, t = s.windows.today, live = s.live_budget;
  const monthCalls = s.adzuna.filter((a) => a.source === "adzuna" && a.month.slice(0, 7) === new Date().toISOString().slice(0, 7)).reduce((a, b) => a + n(b.calls), 0);
  const agentSpend = s.agent_spend.reduce((a, b) => a + n(b.cost_usd), 0);

  const spendChart = {
    tooltip: { trigger: "axis" as const, valueFormatter: (v: any) => usd(v) },
    legend: { top: 0 },
    grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: "category" as const, data: days.map((d) => d.slice(5)) },
    yAxis: { type: "value" as const, axisLabel: { formatter: (v: number) => `$${v}` } },
    series: TIERS.map((tier, i) => ({
      name: TIER_NAME[tier], type: "bar" as const, stack: "cost", barMaxWidth: 22, itemStyle: { color: cat[i] },
      data: days.map((d) => n(s.daily.find((x) => x.day === d && x.tier === tier)?.cost_usd)),
    })),
  };
  const trafficChart = {
    tooltip: { trigger: "axis" as const }, legend: { top: 0 },
    grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: "category" as const, data: days.map((d) => d.slice(5)) },
    yAxis: { type: "value" as const, minInterval: 1 },
    series: [
      { name: "Questions", type: "line" as const, showSymbol: true, itemStyle: { color: cat[0] }, areaStyle: { opacity: 0.1 },
        data: days.map((d) => s.daily.filter((x) => x.day === d).reduce((a, b) => a + n(b.questions), 0)) },
      { name: "Visitors (that day)", type: "line" as const, showSymbol: true, itemStyle: { color: cat[1] },
        data: days.map((d) => Math.max(0, ...s.daily.filter((x) => x.day === d).map((x) => n(x.visitors)))) },
    ],
  };

  return (
    <>
      <h3 className="section">AI analyst</h3>
      <section className="kpis">
        <Kpi label="Spend today" value={usd(t.cost_usd)} hint={`live: ${usd(live.spent_usd)} of ${usd(live.cap_usd)} daily cap`} />
        <Kpi label={`Spend, last ${s.days} days`} value={usd(p.cost_usd)} hint={`${usd(p.avg_cost)} per question on average`} />
        <Kpi label="Questions" value={String(p.questions)} hint={`${t.questions} today · ${p.sql_queries} SQL queries run`} />
        <Kpi label="Unique visitors" value={String(p.visitors)} hint={`${p.sessions} conversations · counted per day`} />
        <Kpi label="Reports & charts" value={`${p.reports} / ${p.charts}`} hint={`avg answer ${secs(p.avg_ms)} · ${p.errors} errors`} tone={p.errors ? "warn" : ""} />
      </section>

      <section className="grid">
        <div className="card span-7"><h2>Daily spend by model tier</h2><p className="desc">US dollars at Anthropic list prices</p>
          <ReactECharts style={{ height: 280 }} option={spendChart} notMerge /></div>
        <div className="card span-5"><h2>Traffic</h2><p className="desc">Questions and unique visitors per day</p>
          <ReactECharts style={{ height: 280 }} option={trafficChart} notMerge /></div>
      </section>

      <section className="grid">
        <div className="card span-7">
          <h2>Cost by model tier</h2>
          <table><thead><tr><th>Tier</th><th className="num">Questions</th><th className="num">Spend</th><th className="num">Avg / question</th><th className="num">Avg time</th></tr></thead>
            <tbody>{s.by_tier.map((r) => <tr key={r.tier}><td>{TIER_NAME[r.tier] ?? r.tier}</td><td className="num">{r.questions}</td>
              <td className="num">{usd(r.cost_usd)}</td><td className="num">{usd(r.avg_cost)}</td><td className="num">{secs(r.avg_ms)}</td></tr>)}</tbody></table>
        </div>
        <div className="card span-5">
          <h2>Where visitors are</h2>
          <table><thead><tr><th>Country</th><th className="num">Visitors</th><th className="num">Questions</th></tr></thead>
            <tbody>{s.countries.map((c) => <tr key={c.country}><td>{c.country}</td><td className="num">{c.visitors}</td><td className="num">{c.questions}</td></tr>)}</tbody></table>
        </div>
      </section>

      <section className="card">
        <h2>Recent questions</h2>
        <p className="desc">Newest first. Click a row for the SQL it ran, tokens and errors. Questions are kept for 90 days; visitors are a daily anonymous ID.</p>
        <div className="table-scroll" style={{ maxHeight: 560 }}>
          <table>
            <thead><tr><th>When</th><th>Question</th><th>Model</th><th className="num">SQL</th><th className="num">Cost</th><th className="num">Time</th><th>Result</th></tr></thead>
            <tbody>{s.recent.map((r) => (
              <Fragment key={r.id}>
                <tr className="rowx" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="small nowrap">{when(r.at)}<div className="muted">{r.country ?? ""} · {r.visitor ?? ""}</div></td>
                  <td>{r.question}</td>
                  <td className="small">{TIER_NAME[r.tier ?? "unknown"] ?? r.tier}{r.mode !== "auto" && <div className="muted">chosen: {r.mode}</div>}</td>
                  <td className="num">{r.queries?.length ?? 0}</td>
                  <td className="num">{r.cost_usd == null ? "—" : usd(r.cost_usd)}</td>
                  <td className="num">{r.duration_ms == null ? "—" : secs(r.duration_ms)}</td>
                  <td>{r.status === "error" ? <span className="pill bad">error</span> : r.report ? <span className="pill lime">report</span> : r.charts ? <span className="pill">{r.charts} chart{r.charts > 1 ? "s" : ""}</span> : <span className="pill">answer</span>}</td>
                </tr>
                {open === r.id && (
                  <tr className="detail"><td colSpan={7}>
                    {r.error && <div className="err">{r.error}</div>}
                    <div className="small muted">Models: {(r.models ?? []).join(" → ") || "—"} · tokens in {r.input_tokens ?? 0}, cached {r.cache_read_tokens ?? 0}, cache write {r.cache_write_tokens ?? 0}, out {r.output_tokens ?? 0}</div>
                    {(r.queries ?? []).map((q, i) => <div key={i} className="q"><b>{q.title}</b> <span className="muted">· {q.rows} rows</span><pre>{q.sql}</pre></div>)}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {!s.recent.length && <tr><td colSpan={7} className="muted">No questions yet.</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <h3 className="section">Data pipeline & agents</h3>
      <section className="kpis">
        <Kpi label="Jobs collected" value={n(s.pipeline.jobs_total).toLocaleString("en-ZA")} hint={`${n(s.pipeline.jobs_open).toLocaleString("en-ZA")} open · ${n(s.pipeline.jobs_7d)} new this week`} />
        <Kpi label="Adzuna calls this month" value={`${monthCalls} / ${ADZUNA_BUDGET}`} hint={`${Math.round(100 * monthCalls / ADZUNA_BUDGET)}% of the monthly budget`} />
        <Kpi label={`Agent spend, ${s.days} days`} value={usd(agentSpend)} hint={s.agent_spend.map((a) => `${a.agent.replace("_", " ")}: ${a.runs} runs`).join(" · ") || "no runs"} />
        <Kpi label="Companies" value={n(s.pipeline.companies).toLocaleString("en-ZA")} hint={`${n(s.pipeline.recruiters)} recruiters · ${n(s.pipeline.foreign_firms)} overseas · ${n(s.pipeline.with_website)} with website`} />
        <Kpi label="Last data fetch" value={s.pipeline.last_fetch ? when(String(s.pipeline.last_fetch)) : "—"} hint="daily at 06:17 SAST" />
      </section>

      <section className="grid">
        <div className="card span-8">
          <h2>Agent runs</h2>
          <div className="table-scroll" style={{ maxHeight: 420 }}>
            <table><thead><tr><th>When</th><th>Agent</th><th>Model</th><th>Status</th><th className="num">Tool calls</th><th className="num">Cost</th><th>Summary</th></tr></thead>
              <tbody>{s.agents.map((a) => <tr key={a.id}><td className="small nowrap">{when(a.started_at)}</td><td>{a.agent.replace("_", " ")}</td>
                <td className="small muted">{a.model}</td><td><span className={"pill" + (a.status === "done" ? " lime" : a.status === "error" ? " bad" : "")}>{a.status}</span></td>
                <td className="num">{a.tool_calls}</td><td className="num">{usd(a.cost_usd)}</td>
                <td className="small">{a.error ? `Error: ${a.error}` : (a.summary ?? "").slice(0, 120)}</td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="card span-4">
          <h2>Sales pipeline</h2>
          <table><thead><tr><th>Stage</th><th className="num">Opportunities</th><th className="num">Drafts</th><th className="num">Emailed</th></tr></thead>
            <tbody>{s.crm.map((c) => <tr key={c.stage}><td>{c.stage.replace("_", " ")}</td><td className="num">{c.opportunities}</td><td className="num">{c.with_draft}</td><td className="num">{c.emailed}</td></tr>)}</tbody></table>
        </div>
      </section>
    </>
  );
}

function App() {
  const [key, setKey] = useState<string>(() => { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } });
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!key) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/admin/stats?days=${days}`, { headers: { Authorization: `Bearer ${key}` } });
      if (r.status === 401) { setErr("That admin key isn't right."); setKey(""); try { localStorage.removeItem(KEY_STORE); } catch { /* */ } return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
      setS(await r.json());
    } catch (e) {
      setErr(`Couldn't load stats: ${(e as Error).message}. The analyst service may be waking up; try again in a minute.`);
    } finally { setLoading(false); }
  }, [key, days]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="wrap admin">
      <PlatformNav active="/admin/" />
      <header className="top">
        <div><h1>Admin</h1><p className="sub">Usage, costs and visitors for the AI analyst, plus the data pipeline and agents.</p></div>
        {key && <div className="actions">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          <button className="btn" onClick={() => { setKey(""); setS(null); try { localStorage.removeItem(KEY_STORE); } catch { /* */ } }}>Lock</button>
        </div>}
      </header>
      {!key && <KeyGate error={err} onKey={(k) => { setKey(k); try { localStorage.setItem(KEY_STORE, k); } catch { /* */ } }} />}
      {key && err && <div className="banner">{err}</div>}
      {key && !s && !err && <div className="muted">Loading… (the free analyst server can take up to a minute to wake up)</div>}
      {key && s && <Dashboard s={s} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
