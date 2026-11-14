import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "./dashboards.css";
import ReactECharts from "../Chart";
import PlatformNav from "../PlatformNav";
import { SignIn, UsageCard } from "../Account";
import { api, getToken, logout, type Me } from "../auth";
import { readTheme } from "../charts";
import { url } from "../site";
import { chartOption, download, fmt, toCSV, type ChartArtifact } from "../analyst/chart";

interface Board { id: number; name: string; tiles: number; updated_at: string }
interface Tile { id: number; size: "half" | "full"; spec: Omit<ChartArtifact, "kind" | "id" | "dataset_id" | "columns" | "rows">;
                 columns?: string[]; rows?: unknown[][]; as_of?: string; error?: string }

const toChart = (t: Tile): ChartArtifact => ({ kind: "chart", id: `t${t.id}`, dataset_id: "", ...t.spec,
  subtitle: t.spec.subtitle || "", columns: t.columns || [], rows: t.rows || [] } as ChartArtifact);
const when = (d: string) => new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function TileView({ t, onChange }: { t: Tile; onChange: (patch: { size?: string; move?: string; delete?: boolean }) => void }) {
  const ref = useRef<any>(null);
  const theme = readTheme();
  const c = toChart(t);
  let body;
  if (t.error) body = <div className="err">{t.error}</div>;
  else if (c.type === "kpi") {
    const yi = c.columns.indexOf(c.y[0]);
    body = <div className="kpi-tile"><b>{fmt(c.rows[0]?.[yi], c.value_format)}</b><span>{c.y[0]}</span></div>;
  } else if (c.type === "table") {
    const idx = [c.columns.indexOf(c.x), ...c.y.map((y) => c.columns.indexOf(y))].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
    body = (
      <div className="table-scroll" style={{ maxHeight: 340 }}>
        <table><thead><tr>{idx.map((i) => <th key={i}>{c.columns[i]}</th>)}</tr></thead>
          <tbody>{c.rows.slice(0, 100).map((r, k) => <tr key={k}>{idx.map((i) => <td key={i} className={typeof r[i] === "number" ? "num" : ""}>
            {typeof r[i] === "number" ? fmt(r[i], c.y.includes(c.columns[i]) ? c.value_format : "number") : String(r[i] ?? "—")}</td>)}</tr>)}</tbody></table>
      </div>);
  } else body = <ReactECharts ref={ref} style={{ height: 320 }} option={chartOption(c, theme)} notMerge />;
  return (
    <div className={"card tile " + t.size}>
      <div className="tile-head">
        <div><h3>{c.title}</h3>{c.subtitle && <div className="muted small">{c.subtitle}</div>}</div>
        <div className="tile-tools">
          <button title="Move earlier" onClick={() => onChange({ move: "up" })}>↑</button>
          <button title="Move later" onClick={() => onChange({ move: "down" })}>↓</button>
          <button title="Width" onClick={() => onChange({ size: t.size === "half" ? "full" : "half" })}>{t.size === "half" ? "Wide" : "Narrow"}</button>
          {!t.error && c.type !== "table" && c.type !== "kpi" && <button onClick={() => {
            const inst = ref.current?.getEchartsInstance();
            if (inst) download(`${c.title}.png`, inst.getDataURL({ pixelRatio: 2, backgroundColor: "#141417" }), "image/png");
          }}>PNG</button>}
          {!t.error && <button onClick={() => download(`${c.title}.csv`, toCSV(c), "text/csv")}>CSV</button>}
          <button title="Remove from dashboard" onClick={() => confirm("Remove this chart from the dashboard?") && onChange({ delete: true })}>×</button>
        </div>
      </div>
      {body}
      <div className="tile-foot muted small">
        {t.as_of && <>Data as of {when(t.as_of)}</>}
        <details><summary>Query</summary><pre>{t.spec.sql}</pre></details>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [limit, setLimit] = useState(0);
  const [current, setCurrent] = useState<number | null>(() => Number(new URLSearchParams(location.search).get("d")) || null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const loadBoards = useCallback(async () => {
    const r = await api<{ dashboards: Board[]; limit: number }>("/dashboards");
    setBoards(r.dashboards); setLimit(r.limit);
    setCurrent((c) => (c && r.dashboards.some((b) => b.id === c) ? c : r.dashboards[0]?.id ?? null));
  }, []);
  const loadTiles = useCallback(async (refresh = false) => {
    if (!current) { setTiles([]); return; }
    setLoading(true); setErr("");
    try {
      const r = await api<{ dashboard: { name: string }; tiles: Tile[] }>(`/dashboards/${current}/data${refresh ? "?refresh=true" : ""}`);
      setTiles(r.tiles); setName(r.dashboard.name);
      history.replaceState(null, "", `?d=${current}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [current]);

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { setMe(await api<Me>("/me")); await loadBoards(); } catch { setMe(null); }
      }
      setChecked(true);
    })();
  }, [loadBoards]);
  useEffect(() => { if (me) loadTiles(); }, [me, current, loadTiles]);

  const tileChange = async (id: number, patch: { size?: string; move?: string; delete?: boolean }) => {
    await api(`/tiles/${id}`, { method: "PATCH", body: patch }).catch((e) => setErr(e.message));
    loadTiles(); loadBoards();
  };
  const exportPptx = async () => {
    const charts = tiles.filter((t) => !t.error).map(toChart);
    if (!charts.length) return;
    (await import("../analyst/export")).chartsToPptx(charts, name);
  };

  if (!checked) return <div className="wrap muted">Loading…</div>;
  return (
    <div className="wrap dash">
      <PlatformNav active="/dashboards/" />
      {!me ? (
        <div className="card gate">
          <span className="tag">Clients</span>
          <h1>Your live dashboards</h1>
          <p className="muted">Sign in with your PIN. Dashboards are built by pinning charts in <a href={url("/analyst/")}>Ask AI</a>; every chart re-runs its query on the live data.</p>
          <SignIn compact onDone={async (m) => { setMe(m); await loadBoards(); }} />
        </div>
      ) : (
        <div className="dash-grid">
          <aside className="dash-side">
            <div className="side-title">Dashboards <span className="muted">({boards.length}/{limit})</span></div>
            {boards.map((b) => (
              <button key={b.id} className={"board" + (b.id === current ? " on" : "")} onClick={() => setCurrent(b.id)}>
                <span>{b.name}</span><em>{b.tiles} chart{b.tiles === 1 ? "" : "s"}</em>
              </button>
            ))}
            <button className="btn sm" disabled={boards.length >= limit} onClick={async () => {
              const n = prompt("Dashboard name", "My dashboard");
              if (!n) return;
              try { const d = await api<{ id: number }>("/dashboards", { body: { name: n } }); await loadBoards(); setCurrent(d.id); }
              catch (e) { setErr((e as Error).message); }
            }}>+ New dashboard</button>
            <div className="side-account"><UsageCard me={me} onLogout={() => { logout(); setMe(null); setBoards([]); setTiles([]); }} /></div>
          </aside>
          <main>
            {current ? (
              <>
                <header className="top">
                  <div><h1>{name || "Dashboard"}</h1><p className="sub">Live from the SA Automation Opportunity Index. Data refreshes every 15 minutes, or on demand.</p></div>
                  <div className="actions">
                    <button className="btn" onClick={() => loadTiles(true)} disabled={loading}>{loading ? "Refreshing…" : "Refresh data"}</button>
                    <button className="btn" onClick={exportPptx} disabled={!tiles.length}>PowerPoint</button>
                    <button className="btn" onClick={async () => {
                      const n = prompt("Rename dashboard", name); if (!n) return;
                      await api(`/dashboards/${current}`, { method: "PATCH", body: { name: n } }); loadBoards(); setName(n);
                    }}>Rename</button>
                    <button className="btn" onClick={async () => {
                      if (!confirm(`Delete the dashboard "${name}"?`)) return;
                      await api(`/dashboards/${current}`, { method: "PATCH", body: { delete: true } }); setCurrent(null); loadBoards();
                    }}>Delete</button>
                  </div>
                </header>
                {err && <div className="banner">{err}</div>}
                {!tiles.length && !loading && <div className="card empty">No charts yet. In <a href={url("/analyst/")}>Ask AI</a>, ask a question and click <b>Pin</b> on any chart.</div>}
                <div className="tiles">{tiles.map((t) => <TileView key={t.id} t={t} onChange={(p) => tileChange(t.id, p)} />)}</div>
              </>
            ) : (
              <div className="card empty">Create your first dashboard, then pin charts to it from <a href={url("/analyst/")}>Ask AI</a>.</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
