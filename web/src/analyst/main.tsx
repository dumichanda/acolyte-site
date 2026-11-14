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

import { API, api, getToken, logout, type Me } from "../auth";
import { SignIn, UsageCard } from "../Account";

/** Signed-in account (null = anonymous demo visitor). */
const AuthCtx = createContext<Me | null>(null);

interface Conv { id: string; title: string; updated_at: string; items?: unknown[]; artifacts?: Record<string, unknown> }
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

const STARTERS = [
  "Which role types have the most automatable work, and where?",
  "Which software do finance admin job ads ask for most?",
  "Who are the top 10 direct employers by automatable value?",
  "Compare Gauteng and Western Cape: roles, scores and salaries",
  "Make me a one-page report on collections and call-centre roles",
];

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

function ReportView({ r, actions = true }: { r: ReportArtifact; actions?: boolean }) {
  const ex = r.exec;
  return (
    <div className="report-art">
      <div className="art-head">
        <div><span className="tag">Report pack</span><h2>{r.title}</h2>
          <div className="muted small">{r.scope ? r.scope + " · " : ""}Acolyte Analyst · {new Date(r.generated).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</div></div>
        {actions && <div className="art-actions">
          <ExportBtn label="PowerPoint" primary run={async () => (await exporter()).reportToPptx(r)} />
          <ExportBtn label="PDF" run={async () => (await exporter()).reportToPdf(r)} />
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
      <div className="muted small foot">Source: SA Automation Opportunity Index (public job ads, refreshed daily). Download the pack for the full method and limits.</div>
    </div>
  );
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

  const refreshAccount = useCallback(async () => {
    if (!getToken()) { setMe(null); setHistory(readLocal()); return; }
    try {
      setMe(await api<Me>("/me"));
      setHistory((await api<{ conversations: Conv[] }>("/conversations")).conversations);
    } catch { setMe(null); setHistory(readLocal()); }
  }, []);
  useEffect(() => { refreshAccount(); }, [refreshAccount]);

  // Anonymous visitors: keep chats in this browser.
  useEffect(() => {
    if (busy || me || !session.current || !items.length) return;
    const first = items.find((i) => i.kind === "user") as { text: string } | undefined;
    const entry: Conv = { id: session.current, title: first?.text ?? "Chat", updated_at: new Date().toISOString(), items, artifacts };
    const next = [entry, ...readLocal().filter((c) => c.id !== entry.id)].slice(0, 25);
    writeLocal(next); setHistory(next);
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
        body: JSON.stringify({ session_id: session.current, question, mode }) });
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
  const placeholder = useMemo(() => (ready ? "Ask about South Africa's job market…" : health === "checking" ? "Waking up the analyst (can take up to a minute)…" : "Analyst offline"), [ready, health]);

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
          <div className="side-account">
            {me ? <UsageCard me={me} onLogout={() => { logout(); reset(); refreshAccount(); }} />
              : <SignIn onDone={(m) => { setMe(m); reset(); refreshAccount(); }} />}
            {me && <a className="link" href="../dashboards/">Your dashboards →</a>}
          </div>
        </aside>
        <section className="chat">
          <header>
            <h1>Ask the data</h1>
            <p className="sub">Acolyte Analyst queries the live SA job-market data, draws the charts and writes the report. Every number comes from a real query you can inspect.</p>
          </header>
          {health === "unconfigured" && <div className="banner">The analyst service isn't connected yet. It runs as a small server (see <code>analyst/</code> in the repo). Once it's deployed, its address goes in <code>site.ts → analystApi</code>.</div>}
          {health === "down" && <div className="banner">The analyst isn't responding. Please try again shortly.</div>}

          <div className="thread">
            {items.length === 0 && (
              <div className="starters">
                <div className="muted small">Try one of these</div>
                {STARTERS.map((s) => <button key={s} className="starter" disabled={!ready} onClick={() => ask(s)}>{s}</button>)}
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
          <p className="muted small">Demo on public job-ad data. Answers can be wrong; check the queries. <a href={url("/#contact")}>Want this on your own data?</a></p>
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
            <div className="canvas-empty">
              <div className="big">Charts and reports appear here</div>
              <p className="muted">Each one is drawn from the live data, can be downloaded as PNG, CSV or PDF, and shows the query behind it.</p>
            </div>
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
