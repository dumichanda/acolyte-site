import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactECharts from "../Chart";
import "../index.css";
import PlatformNav from "../PlatformNav";
import { fmtDate, useChartTheme, useSnapshot } from "../data";
import { scoreColor, type Theme } from "../charts";
import { barEnd, CATEGORICAL, mode, NEUTRAL, scoreChip } from "../viz";
import { rands, type Employer, type Snapshot } from "../types";

type SortKey = "value" | "jobs" | "avg_score";

function postersDonut(p: { kind: string; jobs: number }[], t: Theme) {
  const cat = CATEGORICAL[mode()];
  const colors: Record<string, string> = { "Direct employer": cat[0], "Recruitment agency": cat[1], "Employer not named": NEUTRAL[mode()] };
  return {
    tooltip: { trigger: "item", backgroundColor: t.panel, borderColor: t.line, textStyle: { color: t.ink }, formatter: "{b}: {c} roles ({d}%)" },
    legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: "circle" },
    series: [{
      type: "pie", padAngle: 1, radius: ["58%", "80%"], center: ["50%", "44%"], label: { show: false },
      itemStyle: { borderColor: t.panel, borderWidth: 3 },
      data: p.map((x) => ({ name: x.kind, value: x.jobs, itemStyle: { color: colors[x.kind] ?? "#8d8c93" } })),
    }],
  };
}

function EmployerRow({ e, open, onToggle }: { e: Employer; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="rowx" onClick={onToggle}>
        <td><b>{e.name}</b><div className="muted" style={{ fontSize: 11 }}>{e.industry ?? e.main_family}</div></td>
        <td>{[e.city, e.province].filter(Boolean).join(", ") || "—"}</td>
        <td className="num">{e.jobs}</td>
        <td className="num"><span className="score" style={{ ...scoreChip(e.avg_score) }}>{e.avg_score}</span></td>
        <td className="num">{rands(e.value)}</td>
        <td>{(e.tools ?? []).slice(0, 3).map((t) => <span className="pill" key={t}>{t}</span>)}</td>
        <td className="muted" style={{ textAlign: "right" }}>{open ? "▲" : "▼"}</td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={7}>
            <div className="detail-grid">
              <div>
                <h4>About</h4>
                <p style={{ margin: "0 0 8px" }}>{e.description ?? <span className="muted">No description yet. It is added when the company is researched.</span>}</p>
                <div>
                  {e.website && <a href={`https://${e.website}`} target="_blank" rel="noreferrer">{e.website}</a>}
                  {e.website && e.linkedin_url && " · "}
                  {e.linkedin_url && <a href={e.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  {e.size_band && <>Size {e.size_band} employees · </>}Last ad {e.last_posted ? fmtDate(e.last_posted) : "—"}
                </div>
              </div>
              <div>
                <h4>Open roles</h4>
                {(e.roles ?? []).map((r, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <span className="score" style={{ ...scoreChip(r.score), marginRight: 6 }}>{r.score}</span>
                    {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> : r.title}
                  </div>
                ))}
                {e.jobs > (e.roles?.length ?? 0) && <div className="muted" style={{ fontSize: 12 }}>+{e.jobs - (e.roles?.length ?? 0)} more</div>}
              </div>
              <div>
                <h4>What Acolyte would pitch</h4>
                <p style={{ margin: "0 0 8px" }}>{e.pitch}</p>
                <h4>Tools in their ads</h4>
                {(e.tools ?? []).length ? e.tools!.map((t) => <span className="pill lime" key={t}>{t}</span>) : <span className="muted">None named</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Page({ s, t }: { s: Snapshot; t: Theme }) {
  const all = s.employers ?? [];
  const [q, setQ] = useState("");
  const [prov, setProv] = useState("");
  const [fam, setFam] = useState("");
  const [sort, setSort] = useState<SortKey>("value");
  const [open, setOpen] = useState<string | null>(null);
  const provinces = useMemo(() => [...new Set(all.map((e) => e.province).filter(Boolean))].sort() as string[], [all]);
  const families = useMemo(() => [...new Set(all.flatMap((e) => e.families ?? []))].filter((f) => f !== "Other").sort(), [all]);
  const rows = useMemo(() => all
    .filter((e) => !q || `${e.name} ${e.industry ?? ""} ${(e.tools ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .filter((e) => !prov || e.province === prov)
    .filter((e) => !fam || (e.families ?? []).includes(fam))
    .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0)), [all, q, prov, fam, sort]);

  const direct = s.posters?.find((p) => p.kind === "Direct employer")?.jobs ?? 0;
  const agency = s.posters?.find((p) => p.kind === "Recruitment agency")?.jobs ?? 0;
  const totalValue = all.reduce((a, e) => a + (e.value || 0), 0);
  const withSite = all.filter((e) => e.website).length;

  if (!all.length) return <div className="card empty">Employer data appears after the next daily refresh.</div>;
  return (
    <>
      <section className="kpis">
        <div className="kpi"><div className="label">Hiring employers</div><div className="value">{all.length}</div><div className="hint">recruitment agencies excluded</div></div>
        <div className="kpi"><div className="label">Their automatable work / yr</div><div className="value">{rands(totalValue)}</div><div className="hint">across their open roles</div></div>
        <div className="kpi"><div className="label">Roles posted directly</div><div className="value">{direct}</div><div className="hint">{agency} more via recruiters</div></div>
        <div className="kpi"><div className="label">Researched</div><div className="value">{withSite}</div><div className="hint">website found</div></div>
        <div className="kpi"><div className="label">Biggest opportunity</div><div className="value" style={{ fontSize: 18, lineHeight: 1.3 }}>{all[0].name}</div><div className="hint">{rands(all[0].value)} / yr</div></div>
      </section>

      <section className="grid">
        <div className="card span-8">
          <h2>Who has the most automatable work</h2>
          <p className="desc">Top 15 employers by the yearly cost of the automatable work in their open roles. Colour = automation score.</p>
          <ReactECharts style={{ height: 360 }} option={{
            textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: t.ink },
            tooltip: { backgroundColor: t.panel, borderColor: t.line, textStyle: { color: t.ink },
              formatter: (p: any) => { const e = all.slice(0, 15).reverse()[p.dataIndex]; return `<b>${e.name}</b><br/>${e.jobs} roles · score ${e.avg_score}<br/>${rands(e.value)}/yr`; } },
            grid: { left: 8, right: 60, top: 4, bottom: 4, containLabel: true },
            xAxis: { type: "value", show: false },
            yAxis: { type: "category", data: all.slice(0, 15).reverse().map((e) => e.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.ink, fontSize: 11, width: 170, overflow: "truncate" } },
            series: [{ type: "bar", barWidth: "60%", barMaxWidth: 22, data: all.slice(0, 15).reverse().map((e) => ({ value: e.value, itemStyle: { color: scoreColor(e.avg_score), borderRadius: barEnd(true) } })),
              label: { show: true, position: "right", color: t.muted, fontSize: 11, formatter: (p: any) => rands(p.value) } }],
          }} />
        </div>
        <div className="card span-4">
          <h2>Who posts the jobs</h2>
          <p className="desc">Many ads come from recruitment agencies that hide the real employer. They count in the market figures but are not sales leads.</p>
          <ReactECharts style={{ height: 300 }} option={postersDonut(s.posters ?? [], t)} />
        </div>
      </section>

      <section className="card">
        <h2>All hiring employers</h2>
        <p className="desc">Click a row for the company profile, its open roles and the Acolyte pitch.</p>
        <div className="toolbar">
          <input placeholder="Search company, industry or tool…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={prov} onChange={(e) => setProv(e.target.value)}><option value="">All provinces</option>{provinces.map((p) => <option key={p}>{p}</option>)}</select>
          <select value={fam} onChange={(e) => setFam(e.target.value)}><option value="">All role types</option>{families.map((f) => <option key={f}>{f}</option>)}</select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="value">Sort: automatable value</option><option value="jobs">Sort: open roles</option><option value="avg_score">Sort: automation score</option>
          </select>
          <span className="muted" style={{ fontSize: 12 }}>{rows.length} employers</span>
        </div>
        <div className="table-scroll" style={{ maxHeight: 640 }}>
          <table>
            <thead><tr><th>Employer</th><th>Location</th><th className="num">Roles</th><th className="num">Score</th><th className="num">Automatable / yr</th><th>Tools named</th><th /></tr></thead>
            <tbody>
              {rows.map((e) => <EmployerRow key={e.name} e={e} open={open === e.name} onToggle={() => setOpen(open === e.name ? null : e.name)} />)}
              {!rows.length && <tr><td colSpan={7} className="muted">No employers match.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function App() {
  const { s, err } = useSnapshot();
  const t = useChartTheme();
  return (
    <div className="wrap">
      <PlatformNav active="/employers/" />
      <header className="top">
        <div>
          <h1>Who is hiring</h1>
          <p className="sub">The South African employers behind today's open roles, ranked by how much of the advertised work automation could take on.</p>
        </div>
        {s && <div className="updated">Updated {fmtDate(s.generated_at)}</div>}
      </header>
      {err && <div className="card">Could not load data: {err}</div>}
      {!err && (!s || !t) && <div className="muted">Loading…</div>}
      {s && t && <Page s={s} t={t} />}
      <footer><span>Company names come from public job ads. Profiles come from each company's own website and public search results.</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
