import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { Snapshot, Job } from "./types";
import { rands } from "./types";
import { url } from "./site";
import { familyBar, heatmap, provinceBar, readTheme, scoreColor, scoreDist, trend, type Theme } from "./charts";

const isReport = new URLSearchParams(location.search).has("report");

function useTheme(): Theme | null {
  const [t, setT] = useState<Theme | null>(null);
  useEffect(() => {
    if (isReport) document.documentElement.dataset.theme = "light";
    const update = () => setT(readTheme());
    update();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return t;
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

function Kpis({ s }: { s: Snapshot }) {
  const k = s.kpis;
  const items = [
    { label: "Open roles tracked", value: k.jobs.toLocaleString("en-ZA"), hint: `${k.companies} employers` },
    { label: "Automatable work / year", value: rands(k.automatable_value), hint: "at full cost-to-company" },
    { label: "Avg automation score", value: `${k.avg_score}/100`, hint: "share of role time" },
    { label: "High-potential roles", value: `${k.high_share}%`, hint: "score 60 or more" },
    { label: "New in last 7 days", value: k.jobs_7d.toLocaleString("en-ZA"), hint: `median salary ${rands(k.median_salary)}` },
  ];
  return (
    <section className="kpis">
      {items.map((i) => (
        <div className="kpi" key={i.label}>
          <div className="label">{i.label}</div>
          <div className="value">{i.value}</div>
          <div className="hint">{i.hint}</div>
        </div>
      ))}
    </section>
  );
}

function Insight({ s }: { s: Snapshot }) {
  const c = s.commentary;
  return (
    <div className="card insight">
      <span className="tag">{c.source === "template" ? "Auto-generated insight" : "Written by Claude"}</span>
      <h3>{c.headline}</h3>
      <ul>{c.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      <div className="reco"><b>Where to focus: </b>{c.recommendation}</div>
    </div>
  );
}

function JobsTable({ jobs, limit }: { jobs: Job[]; limit?: number }) {
  const rows = limit ? jobs.slice(0, limit) : jobs;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>Role</th><th>Employer</th><th>Location</th><th className="num">Score</th><th className="num">Automatable / yr</th><th>What Acolyte would pitch</th></tr>
        </thead>
        <tbody>
          {rows.map((j, i) => (
            <tr key={i}>
              <td>{j.url ? <a href={j.url} target="_blank" rel="noreferrer">{j.title}</a> : j.title}<div className="muted" style={{ fontSize: 11 }}>{j.family}</div></td>
              <td>{j.company ?? "—"}</td>
              <td>{[j.city, j.province].filter(Boolean).join(", ") || "—"}</td>
              <td className="num"><span className="score" style={{ background: scoreColor(j.score) }}>{j.score}</span></td>
              <td className="num">{rands(j.value)}{j.salary_imputed && <span className="muted" title="Salary not advertised; typical salary for this role used">*</span>}</td>
              <td className="muted">{j.service}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="muted">No roles match this filter.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ s, t }: { s: Snapshot; t: Theme }) {
  const [family, setFamily] = useState<string | null>(null);
  const [province, setProvince] = useState<string | null>(null);

  const families = useMemo(() => s.by_family.filter((f) => f.family !== "Other").slice(0, 12).map((f) => f.family), [s]);
  const provinces = useMemo(() => s.by_province.filter((p) => p.province !== "Unknown").map((p) => p.province).reverse(), [s]);
  const jobs = useMemo(
    () => s.top_jobs.filter((j) => (!family || j.family === family) && (!province || j.province === province)),
    [s, family, province],
  );
  const fam = s.by_family.find((f) => f.family === family);

  return (
    <>
      <Kpis s={s} />

      <section className="grid">
        <div className="card span-7">
          <h2>Where the automatable value is</h2>
          <p className="desc">Annual cost of automatable work by role family. Colour = automation score. Click a bar to filter.</p>
          <ReactECharts style={{ height: 430 }} option={familyBar(s.by_family, t, family)} notMerge
            onEvents={{ click: (p: any) => setFamily((cur) => (cur === p.name ? null : p.name)) }} />
        </div>
        <div className="span-5" style={{ display: "grid", gap: 14 }}>
          <Insight s={s} />
          <div className="card">
            <h2>How automatable are SA roles?</h2>
            <p className="desc">Number of roles by automation score</p>
            <ReactECharts style={{ height: 170 }} option={scoreDist(s.score_dist, t)} />
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="card span-8">
          <h2>Role family × province</h2>
          <p className="desc">Number = open roles. Colour = average automation score. Click a cell to filter.</p>
          <ReactECharts style={{ height: 400 }} option={heatmap(s.heatmap, families, provinces, t)} notMerge
            onEvents={{ click: (p: any) => { setFamily(families[p.data[0]]); setProvince(provinces[p.data[1]]); } }} />
        </div>
        <div className="card span-4">
          <h2>Hiring by province</h2>
          <p className="desc">Open roles tracked. Click to filter.</p>
          <ReactECharts style={{ height: 400 }} option={provinceBar(s.by_province, t, province)} notMerge
            onEvents={{ click: (p: any) => setProvince((cur) => (cur === p.name ? null : p.name)) }} />
        </div>
      </section>

      <section className="grid">
        <div className="card span-12">
          <h2>New roles per day</h2>
          <p className="desc">Last 45 days, all tracked roles vs high-potential roles</p>
          <ReactECharts style={{ height: 260 }} option={trend(s.trend, t)} />
        </div>
      </section>

      <section className="grid">
        <div className="card span-12">
          <h2>Top automation opportunities</h2>
          <div className="filters">
            {!family && !province && <span className="muted">Showing all roles. Click any chart to filter.</span>}
            {family && <button className="chip" onClick={() => setFamily(null)}>{family} ✕</button>}
            {province && <button className="chip" onClick={() => setProvince(null)}>{province} ✕</button>}
          </div>
          {fam && (
            <div className="family-detail">
              <div><b>Acolyte solution</b>{fam.service}</div>
              <div><b>Typical automatable tasks</b>{fam.tasks.join(" · ")}</div>
            </div>
          )}
          <JobsTable jobs={jobs} limit={50} />
        </div>
      </section>
    </>
  );
}

function Report({ s, t }: { s: Snapshot; t: Theme }) {
  const opts = { renderer: "svg" as const };
  const noAnim = (o: any) => ({ ...o, animation: false });
  const families = s.by_family.filter((f) => f.family !== "Other").slice(0, 12).map((f) => f.family);
  const provinces = s.by_province.filter((p) => p.province !== "Unknown").map((p) => p.province).reverse();
  const foot = (n: number) => (
    <div className="pfoot"><span>Acolyte · SA Automation Opportunity Index · {fmtDate(s.generated_at)}{s.meta.has_demo ? " · SAMPLE DATA" : ""}</span><span>Page {n} of 2</span></div>
  );
  return (
    <div className="report">
      <div className="page">
        <div className="brand"><div className="brand-mark" />ACOLYTE</div>
        <h1>SA Automation Opportunity Index</h1>
        <p className="sub">Open roles {fmtDate(s.meta.from_date)} – {fmtDate(s.meta.to_date)}</p>
        {s.meta.has_demo && <div className="banner" style={{ marginTop: 10 }}>Sample data for demonstration. Employers are fictional.</div>}
        <div style={{ height: 12 }} />
        <Kpis s={s} />
        <Insight s={s} />
        <div style={{ height: 12 }} />
        <div className="card">
          <h2>Where the automatable value is</h2>
          <ReactECharts style={{ height: 360 }} opts={opts} option={noAnim(familyBar(s.by_family, t, null))} />
        </div>
        {foot(1)}
      </div>
      <div className="page">
        <div className="card">
          <h2>Role family × province</h2>
          <p className="desc">Number = open roles; colour = average automation score</p>
          <ReactECharts style={{ height: 310 }} opts={opts} option={noAnim(heatmap(s.heatmap, families, provinces, t))} />
        </div>
        <div style={{ height: 12 }} />
        <div className="card">
          <h2>Top 8 opportunities</h2>
          <JobsTable jobs={s.top_jobs} limit={8} />
        </div>
        {foot(2)}
      </div>
    </div>
  );
}

export default function App() {
  const [s, setS] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const t = useTheme();
  useEffect(() => {
    fetch(url("/data/snapshot.json"))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then(setS)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="wrap">Could not load data: {err}</div>;
  if (!s || !t) return <div className="wrap muted">Loading…</div>;
  if (isReport) return <Report s={s} t={t} />;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <a className="brand" href={url("/")} style={{ textDecoration: "none" }}><div className="brand-mark" />ACOLYTE</a>
          <h1>SA Automation Opportunity Index</h1>
          <p className="sub">Which jobs South Africa is hiring for right now, and how much of that work AI and automation could do.</p>
        </div>
        <div className="updated">
          Updated {fmtDate(s.generated_at)}<br />
          <a className="btn" href="?report" target="_blank" style={{ marginTop: 8 }}>Printable report</a>{" "}
          <a className="btn" href={url("/#contact")} style={{ marginTop: 8, background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}>Talk to Acolyte</a>
        </div>
      </header>
      {s.meta.has_demo && (
        <div className="banner"><b>Sample data.</b> These figures are generated for demonstration and the employers are fictional. Live Adzuna data replaces them on the next refresh.</div>
      )}
      <Dashboard s={s} t={t} />
      <footer>
        <span>Automatable value = salary × 1.25 (cost-to-company) × automation score. * salary not advertised; typical salary for the role used.</span>
        <span>Jobs data by <a href="https://www.adzuna.co.za" target="_blank" rel="noreferrer">Adzuna</a> and public job listings found by web search</span>
      </footer>
    </div>
  );
}
