import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactECharts from "echarts-for-react";
import "../index.css";
import PlatformNav from "../PlatformNav";
import { fmtDate, useChartTheme, useSnapshot } from "../data";
import { scoreColor, type Theme } from "../charts";
import type { Counted, Insights, Snapshot } from "../types";

const LABELS: Record<string, string> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote", junior: "Junior", mid: "Mid-level", senior: "Senior", manager: "Manager" };

const tip = (t: Theme) => ({ backgroundColor: t.panel, borderColor: t.line, textStyle: { color: t.ink } });

function hbar(items: Counted[], total: number, t: Theme, colorByScore = true) {
  const rows = [...items].reverse();
  return {
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: t.ink },
    tooltip: { ...tip(t), formatter: (p: any) => { const r = rows[p.dataIndex]; return `<b>${r.name}</b><br/>${r.jobs} ads (${Math.round(100 * r.jobs / total)}%)${r.avg_score != null ? `<br/>avg automation score ${r.avg_score}` : ""}`; } },
    grid: { left: 8, right: 56, top: 4, bottom: 4, containLabel: true },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink, fontSize: 11, width: 180, overflow: "truncate" } },
    series: [{
      type: "bar", barWidth: "62%", barMaxWidth: 22,
      data: rows.map((r) => ({ value: r.jobs, itemStyle: { color: colorByScore && r.avg_score != null ? scoreColor(r.avg_score) : "#7cc4ff", borderRadius: [0, 6, 6, 0] } })),
      label: { show: true, position: "right", color: t.muted, fontSize: 11, formatter: (p: any) => `${Math.round(100 * p.value / total)}%` },
    }],
  };
}

function donut(items: Counted[], t: Theme) {
  const palette = ["#c8f135", "#7cc4ff", "#ff6a3d", "#ffb86b", "#8d8c93"];
  return {
    tooltip: { ...tip(t), trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: "circle" },
    series: [{ type: "pie", radius: ["52%", "78%"], center: ["50%", "42%"], label: { show: false }, itemStyle: { borderColor: t.panel, borderWidth: 3 },
      data: items.map((x, i) => ({ name: LABELS[x.name] ?? x.name, value: x.jobs, itemStyle: { color: palette[i % palette.length] } })) }],
  };
}

function toolHeatmap(ins: Insights, families: string[], t: Theme) {
  const tools = ins.tools.slice(0, 12).map((x) => x.name);
  const tx = new Map(tools.map((x, i) => [x, i]));
  const fy = new Map(families.map((f, i) => [f, i]));
  const data = ins.tool_by_family.filter((c) => tx.has(c.tool) && fy.has(c.family)).map((c) => [tx.get(c.tool)!, fy.get(c.family)!, c.jobs]);
  const max = Math.max(1, ...data.map((d) => d[2]));
  return {
    textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: t.ink },
    tooltip: { ...tip(t), formatter: (p: any) => `<b>${tools[p.data[0]]}</b> in ${families[p.data[1]]}<br/>${p.data[2]} ads` },
    grid: { left: 8, right: 8, top: 8, bottom: 60, containLabel: true },
    xAxis: { type: "category", data: tools, axisLabel: { color: t.muted, fontSize: 10, rotate: 35, interval: 0 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "category", data: families, axisLabel: { color: t.ink, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: { min: 0, max, show: false, inRange: { color: ["#1d1f14", "#4d5e22", "#7fa315", "#c8f135"] } },
    series: [{ type: "heatmap", data, label: { show: true, color: "#ecebe6", fontSize: 10, textBorderColor: "#0c0c0e", textBorderWidth: 2 }, itemStyle: { borderColor: t.panel, borderWidth: 2, borderRadius: 4 } }],
  };
}

function Page({ s, t }: { s: Snapshot; t: Theme }) {
  const ins = s.insights;
  const [fam, setFam] = useState("");
  const families = useMemo(() => s.by_family.filter((f) => f.family !== "Other").slice(0, 10).map((f) => f.family), [s]);
  const famTools = useMemo(() => {
    if (!ins || !fam) return null;
    const jobs = s.by_family.find((f) => f.family === fam)?.jobs ?? 1;
    const rows = ins.tool_by_family.filter((c) => c.family === fam).sort((a, b) => b.jobs - a.jobs).slice(0, 12);
    return { jobs, rows: rows.map((r) => ({ name: r.tool, jobs: r.jobs })) };
  }, [ins, fam, s]);
  if (!ins || !ins.jobs_analysed) return <div className="card empty">Tools & skills data appears after the next daily refresh.</div>;
  const n = ins.jobs_analysed;
  const withTool = ins.tools.reduce((a, x) => Math.max(a, x.jobs), 0);
  const remote = ins.work_mode.filter((w) => w.name !== "onsite").reduce((a, w) => a + w.jobs, 0);

  return (
    <>
      <section className="kpis">
        <div className="kpi"><div className="label">Job ads analysed</div><div className="value">{n}</div><div className="hint">{ins.full_text} with full ad text</div></div>
        <div className="kpi"><div className="label">Most-requested tool</div><div className="value" style={{ fontSize: 20 }}>{ins.tools[0]?.name ?? "—"}</div><div className="hint">in {Math.round(100 * withTool / n)}% of ads</div></div>
        <div className="kpi"><div className="label">Most-requested skill</div><div className="value" style={{ fontSize: 20 }}>{ins.skills[0]?.name ?? "—"}</div><div className="hint">in {Math.round(100 * (ins.skills[0]?.jobs ?? 0) / n)}% of ads</div></div>
        <div className="kpi"><div className="label">Remote or hybrid</div><div className="value">{Math.round(100 * remote / n)}%</div><div className="hint">of roles</div></div>
        <div className="kpi"><div className="label">Different tools named</div><div className="value">{ins.tools.length}</div><div className="hint">across all role types</div></div>
      </section>

      <section className="grid">
        <div className="card span-6">
          <h2>Software named in job ads</h2>
          <p className="desc">Share of ads naming each tool. Colour = average automation score of those roles. These are the systems an automation has to plug into.</p>
          <ReactECharts style={{ height: 440 }} option={hbar(ins.tools.slice(0, 15), n, t)} />
        </div>
        <div className="card span-6">
          <h2>Skills and tasks asked for</h2>
          <p className="desc">Share of ads mentioning each skill. High-score skills are the routine work AI and automation can take on.</p>
          <ReactECharts style={{ height: 440 }} option={hbar(ins.skills.slice(0, 15), n, t)} />
        </div>
      </section>

      <section className="grid">
        <div className="card span-8">
          <h2>Which tools each role type uses</h2>
          <p className="desc">Number of ads naming a tool, by role type.</p>
          <ReactECharts style={{ height: 420 }} option={toolHeatmap(ins, families, t)} />
        </div>
        <div className="card span-4">
          <h2>Tools for one role type</h2>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <select value={fam} onChange={(e) => setFam(e.target.value)} style={{ flex: 1 }}>
              <option value="">Choose a role type…</option>
              {families.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          {famTools ? (famTools.rows.length
            ? <ReactECharts style={{ height: 340 }} option={hbar(famTools.rows, famTools.jobs, t, false)} />
            : <div className="empty">No tools named in these ads yet.</div>)
            : <div className="empty">Pick a role type to see the software its ads mention.</div>}
        </div>
      </section>

      <section className="grid">
        <div className="card span-4">
          <h2>Where the work happens</h2>
          <ReactECharts style={{ height: 240 }} option={donut(ins.work_mode, t)} />
        </div>
        <div className="card span-4">
          <h2>Seniority</h2>
          <ReactECharts style={{ height: 240 }} option={donut(ins.seniority, t)} />
        </div>
        <div className="card span-4">
          <h2>Qualifications and languages</h2>
          <p className="desc">Share of ads asking for each</p>
          <table><tbody>
            {[...ins.qualifications, ...ins.languages].map((q) => (
              <tr key={q.name}><td>{q.name}</td><td className="num">{Math.round(100 * q.jobs / n)}%</td></tr>
            ))}
          </tbody></table>
        </div>
      </section>

      {ins.experience.length > 0 && (
        <section className="card">
          <h2>Experience asked for</h2>
          <p className="desc">Average years of experience in ads that state it, by role type</p>
          <table>
            <thead><tr><th>Role type</th><th className="num">Avg years</th><th className="num">Ads stating it</th></tr></thead>
            <tbody>{ins.experience.map((e) => <tr key={e.family}><td>{e.family}</td><td className="num">{e.avg_years}</td><td className="num">{e.jobs}</td></tr>)}</tbody>
          </table>
        </section>
      )}
    </>
  );
}

function App() {
  const { s, err } = useSnapshot();
  const t = useChartTheme();
  return (
    <div className="wrap">
      <PlatformNav active="/tools/" />
      <header className="top">
        <div>
          <h1>Tools & skills in demand</h1>
          <p className="sub">What South African job ads ask for: the software, skills and qualifications behind the roles automation can help with.</p>
        </div>
        {s && <div className="updated">Updated {fmtDate(s.generated_at)}</div>}
      </header>
      {err && <div className="card">Could not load data: {err}</div>}
      {!err && (!s || !t) && <div className="muted">Loading…</div>}
      {s && t && <Page s={s} t={t} />}
      <footer><span>Extracted from job ad text with keyword rules. Most ads are short summaries, so tools are under-counted; full ad text is added daily where the employer's own site has it.</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
