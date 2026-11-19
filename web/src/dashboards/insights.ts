/**
 * Dashboard filters and key insights, computed in the browser from the data on screen (no AI cost, instant).
 * - Period filter applies to tiles whose x axis is a date; category filters apply to tiles that have that column.
 * - Insights are recomputed for the filtered view; with no filters set the default view is the current month.
 * - viewContext() turns the filtered view into text for "Ask Acolyte AI" so its answer matches what is on screen.
 */
import { fmt, type ChartArtifact } from "../analyst/chart";

export type Period = "month" | "30d" | "3m" | "12m" | "all";
export const PERIODS: [Period, string][] = [["month", "This month"], ["30d", "Last 30 days"], ["3m", "Last 3 months"], ["12m", "Last 12 months"], ["all", "All time"]];
export interface Filters { period: Period; dims: Record<string, string> }   // dims: column -> value ("" = all)
export const DEFAULT_FILTERS: Filters = { period: "month", dims: {} };

const DATE_RX = /^\d{4}-\d{2}(-\d{2})?([T ].*)?$/;
const asDate = (v: unknown): Date | null => {
  if (typeof v !== "string" || !DATE_RX.test(v)) return null;
  const d = new Date(v.length === 7 ? v + "-01T00:00:00" : v.length === 10 ? v + "T00:00:00" : v);
  return isNaN(+d) ? null : d;
};
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(+v) ? +v : null);

/** Index of the date column a tile is plotted against, or -1. */
export function dateCol(c: ChartArtifact): number {
  const xi = c.columns.indexOf(c.x);
  const cand = xi >= 0 ? [xi, ...c.columns.map((_, i) => i).filter((i) => i !== xi)] : c.columns.map((_, i) => i);
  for (const i of cand) {
    const vals = c.rows.slice(0, 20).map((r) => r[i]).filter((v) => v != null);
    if (vals.length && vals.every((v) => asDate(v))) return i;
  }
  return -1;
}

/** Text columns shared by tiles, with their values: the candidates for category filters (area, category, brand…). */
export function dimensions(charts: ChartArtifact[]): { col: string; values: string[]; tiles: number }[] {
  const m = new Map<string, { values: Set<string>; tiles: number }>();
  for (const c of charts) {
    if (c.type === "kpi") continue;
    const di = dateCol(c);
    c.columns.forEach((col, i) => {
      if (i === di || c.y.includes(col)) return;
      const vals = c.rows.map((r) => r[i]).filter((v) => typeof v === "string" && v !== "") as string[];
      if (vals.length < 2 || vals.some((v) => asDate(v))) return;
      const key = [...m.keys()].find((k) => k.toLowerCase() === col.toLowerCase()) || col;   // "Province" = "province"
      const e = m.get(key) || { values: new Set<string>(), tiles: 0 };
      vals.forEach((v) => e.values.add(v)); e.tiles++; m.set(key, e);
    });
  }
  return [...m.entries()].map(([col, e]) => ({ col, values: [...e.values].sort(), tiles: e.tiles }))
    .filter((d) => d.values.length >= 2 && d.values.length <= 80)
    .sort((a, b) => b.tiles - a.tiles || a.values.length - b.values.length).slice(0, 3);
}

const periodStart = (p: Period, now = new Date()): Date | null => {
  if (p === "all") return null;
  if (p === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  const d = new Date(now); d.setDate(d.getDate() - (p === "30d" ? 30 : p === "3m" ? 91 : 365)); return d;
};

export interface Filtered { chart: ChartArtifact; note: string; timed: boolean }

/** Apply the filters to one tile. "This month" with no rows this month falls back to the latest month in the data. */
export function applyFilters(c: ChartArtifact, f: Filters): Filtered {
  let rows = c.rows, note = "";
  for (const [col, val] of Object.entries(f.dims)) {
    const i = c.columns.findIndex((x) => x.toLowerCase() === col.toLowerCase());
    if (val && i >= 0) rows = rows.filter((r) => String(r[i]) === val);
  }
  const di = dateCol(c);
  if (di >= 0) {
    const start = periodStart(f.period);
    if (start) {
      let kept = rows.filter((r) => { const d = asDate(r[di]); return d && d >= start; });
      if (!kept.length && f.period === "month" && rows.length) {
        const latest = rows.map((r) => asDate(r[di])).filter(Boolean).sort((a, b) => +b! - +a!)[0]!;
        const ls = new Date(latest.getFullYear(), latest.getMonth(), 1);
        kept = rows.filter((r) => { const d = asDate(r[di]); return d && d >= ls; });
        note = `latest month in the data (${ls.toLocaleDateString("en-ZA", { month: "long", year: "numeric" })})`;
      }
      // a trend needs at least two points: keep the last two before the window if it holds only one
      if (kept.length === 1 && rows.length > 1 && c.type !== "table") {
        const sorted = [...rows].sort((a, b) => +asDate(a[di])! - +asDate(b[di])!);
        kept = sorted.slice(Math.max(0, sorted.indexOf(kept[0]) - 1), sorted.indexOf(kept[0]) + 1);
      }
      rows = kept;
    }
  }
  return { chart: { ...c, rows }, note, timed: di >= 0 };
}

export interface Insight { text: string; tone: "up" | "down" | "flat" | "info"; tile: string; weight: number }

const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const f1 = (v: number) => `${v > 0 ? "+" : ""}${Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)}%`;
const dlabel = (v: unknown) => { const d = asDate(v); return d ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : String(v); };

/** Plain-language findings for one filtered tile. */
export function tileInsights(c: ChartArtifact): Insight[] {
  const out: Insight[] = [];
  if (!c.rows.length) return out;
  const vf = c.value_format, tile = c.title;
  const xi = c.columns.indexOf(c.x), di = dateCol(c);
  const y = c.y.find((col) => c.rows.some((r) => num(r[c.columns.indexOf(col)]) !== null));
  if (!y) return out;
  const yi = c.columns.indexOf(y);
  const show = (v: number) => fmt(v, vf);

  if (c.type === "kpi") {
    const v = num(c.rows[0][yi]);
    if (v !== null) out.push({ text: `${y}: ${show(v)}.`, tone: "info", tile, weight: 1 });
    return out;
  }
  if (di >= 0) {   // time series: change over the window (per group when the tile holds several series), and the peak
    const gi = c.columns.findIndex((col, i) => i !== di && i !== yi && !c.y.includes(col) && c.rows.some((r) => typeof r[i] === "string" && !asDate(r[i])));
    const groups = new Map<string, { d: unknown; v: number }[]>();
    for (const r of c.rows) {
      const v = num(r[yi]); if (v === null || !asDate(r[di])) continue;
      const k = gi >= 0 ? String(r[gi]) : ""; (groups.get(k) || groups.set(k, []).get(k)!).push({ d: r[di], v });
    }
    const moves = [...groups.entries()].map(([k, pts]) => {
      pts.sort((a, b) => +asDate(a.d)! - +asDate(b.d)!);
      const a = pts[0], b = pts[pts.length - 1];
      return { k, pts, a, b, ch: pts.length >= 2 ? pct(b.v, a.v) : null };
    });
    const say = (m: typeof moves[0]) => {
      const who = m.k ? `${m.k}: ` : "";
      if (m.ch === null) return { text: `${who}${y} ${show(m.b.v)} (${dlabel(m.b.d)}).`, tone: "info" as const, weight: 0.8 };
      const flat = Math.abs(m.ch) < 1;
      const pair = `${show(m.a.v)} to ${show(m.b.v)}`, exact = show(m.a.v) === show(m.b.v)
        ? [m.a.v, m.b.v].map((v) => (vf === "rand" ? "R" : "") + v.toLocaleString("en-ZA", { maximumFractionDigits: 0 })).join(" to ") : pair;
      return { text: `${who}${y} ${flat ? `held steady at ${show(m.b.v)}` : `${m.ch > 0 ? "rose" : "fell"} ${f1(Math.abs(m.ch)).replace("+", "")}, from ${exact}`} (${dlabel(m.a.d)} → ${dlabel(m.b.d)}).`,
        tone: (flat ? "flat" : m.ch > 0 ? "up" : "down") as Insight["tone"], weight: 2 + Math.min(Math.abs(m.ch) / 10, 3) };
    };
    const ranked = moves.filter((m) => m.ch !== null).sort((a, b) => b.ch! - a.ch!);
    const pickd = moves.length === 1 ? moves : ranked.length ? [ranked[0], ...(ranked.length > 1 ? [ranked[ranked.length - 1]] : [])] : moves.slice(0, 2);
    pickd.forEach((m) => out.push({ ...say(m), tile }));
    if (moves.length === 1 && moves[0].pts.length >= 4) {
      const m = moves[0], peak = m.pts.reduce((x, p) => (p.v > x.v ? p : x));
      if (peak !== m.b && peak !== m.a) out.push({ text: `${y} peaked at ${show(peak.v)} on ${dlabel(peak.d)}.`, tone: "info", tile, weight: 1.2 });
    }
    return out;
  }
  // categories: the leader, how far ahead it is, and the bottom
  const li = xi >= 0 ? xi : c.columns.findIndex((_, i) => i !== yi);
  const items = c.rows.map((r) => ({ k: String(r[li] ?? "—"), v: num(r[yi]) })).filter((x) => x.v !== null) as { k: string; v: number }[];
  if (!items.length) return out;
  const sorted = [...items].sort((a, b) => b.v - a.v), top = sorted[0], low = sorted[sorted.length - 1];
  const avg = items.reduce((s, x) => s + x.v, 0) / items.length;
  if (items.length === 1) { out.push({ text: `${top.k}: ${y} ${show(top.v)}.`, tone: "info", tile, weight: 1 }); return out; }
  const vsAvg = pct(top.v, avg);
  out.push({ text: `${top.k} leads on ${y.toLowerCase()} at ${show(top.v)}${vsAvg !== null && Math.abs(vsAvg) >= 5 ? `, ${f1(vsAvg).replace("+", "")} above the average of the ${items.length} shown` : ""}.`,
    tone: "up", tile, weight: 1.5 + Math.min((vsAvg || 0) / 50, 2) });
  if (items.length >= 3) {
    const share = items.every((x) => x.v >= 0) ? (top.v / items.reduce((s, x) => s + x.v, 0)) * 100 : null;
    if (share !== null && share >= 30 && vf !== "percent") out.push({ text: `${top.k} alone makes up ${Math.round(share)}% of the total.`, tone: "info", tile, weight: 1.3 });
    out.push({ text: `${low.k} is lowest at ${show(low.v)}${top.v && low.v > 0 ? ` (${(top.v / low.v).toFixed(1)}× less than ${top.k})` : ""}.`, tone: "down", tile, weight: 1.1 });
  }
  return out;
}

/** The headline insights for the whole view: the strongest few, at most two per tile. */
export function keyInsights(charts: ChartArtifact[], max = 6): Insight[] {
  const all = charts.flatMap((c) => tileInsights(c).sort((a, b) => b.weight - a.weight).slice(0, 2));
  return all.sort((a, b) => b.weight - a.weight).slice(0, max);
}

export function filterLabel(f: Filters): string {
  const p = PERIODS.find(([k]) => k === f.period)?.[1] || "";
  const month = new Date().toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const dims = Object.entries(f.dims).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return [f.period === "month" ? `${month} (this month)` : p, ...dims].join(" · ");
}

/** The view as text for the AI: filters, then each tile's filtered rows (capped). */
export function viewContext(name: string, f: Filters, views: Filtered[], insights: Insight[]): string {
  const lines = [`Dashboard: ${name}`, `Filters: ${filterLabel(f)}`, `Today: ${new Date().toISOString().slice(0, 10)}`, ""];
  if (insights.length) lines.push("Key insights shown:", ...insights.map((i) => `- ${i.text} [${i.tile}]`), "");
  let budget = 13000 - lines.join("\n").length;
  for (const v of views) {
    const c = v.chart;
    const head = `## ${c.title}${v.note ? ` (${v.note})` : ""}${v.timed ? "" : " (not time-based; period filter not applied)"}\nchart: ${c.type}; x: ${c.x}; y: ${c.y.join(", ")}; format: ${c.value_format}\nsql: ${(c.sql || "").replace(/\s+/g, " ").slice(0, 400)}\n${c.columns.join(" | ")}`;
    const rows = c.rows.slice(0, 40).map((r) => r.map((x) => (x == null ? "" : String(x))).join(" | "));
    const block = [head, ...rows, c.rows.length > 40 ? `… ${c.rows.length - 40} more rows` : ""].join("\n");
    if (block.length > budget) { lines.push(head + "\n(rows omitted for length)"); budget -= head.length; continue; }
    lines.push(block, ""); budget -= block.length;
  }
  return lines.join("\n").slice(0, 15500);
}
