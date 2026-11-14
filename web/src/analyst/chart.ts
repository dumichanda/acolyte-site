import type { EChartsOption } from "echarts";

export interface ChartArtifact {
  kind: "chart"; id: string; dataset_id: string; type: string; x: string; y: string[];
  title: string; subtitle: string; value_format: string; columns: string[]; rows: unknown[][]; sql: string;
  annotations?: Annotation[];
}
/** Analyst call-outs: a point (anomaly, record), a line (event, target, average) or a band (period, normal range). */
export interface Annotation { kind: "point" | "line" | "band"; at: string; to: string; y: number | null; y_to: number | null; label: string; tone: string }
const TONE = (tone: string, print: boolean) =>
  tone === "negative" ? "#e5534b" : tone === "positive" ? "#3fb950" : tone === "neutral" ? (print ? "#6b6656" : "#8d8c93") : (print ? "#5d7a0a" : "#c8f135");
export interface Kpi { value: string; label: string; context: string; tone: "brand" | "positive" | "negative" | "neutral" | string }
export interface Section {
  heading: string; body: string; chart_ids: string[];
  question?: string; title?: string; takeaway?: string; kpis?: Kpi[]; so_what?: string; note?: string; bullets?: string[];
}
export interface ReportArtifact {
  kind: "report"; id: string; title: string; summary: string; generated: string;
  sections: Section[];
  charts: Record<string, ChartArtifact>;
  scope?: string; cover_kpis?: Kpi[]; questions?: string[];
  exec?: { title: string; takeaway: string; kpis: Kpi[]; so_what: string; catch: string };
  qa?: { q: string; a: string }[];
  conclusions?: { findings?: string[]; risks?: string[]; actions?: string[] };
  method?: { steps?: string[]; trust?: string[]; limits?: string[] };
}

/** Readable label for a SQL column name: "pct_high_potential" -> "% high potential". */
export function human(col: string): string {
  if (/[A-Z ]/.test(col) && !col.includes("_")) return col;
  const s = col.replace(/^pct_/, "% ").replace(/_pct$/, " %").replace(/_zar$/, " (R)").replace(/_/g, " ").replace(/\bavg\b/i, "avg").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export type Artifact = ChartArtifact | ReportArtifact;

import { CATEGORICAL, barEnd } from "../viz";
const PALETTE = (print: boolean) => CATEGORICAL[print ? "light" : "dark"];

export function fmt(v: unknown, f: string): string {
  if (typeof v !== "number") return v == null ? "—" : String(v);
  if (f === "rand") return Math.abs(v) >= 1e9 ? `R${(v / 1e9).toFixed(1)}bn` : Math.abs(v) >= 1e6 ? `R${(v / 1e6).toFixed(1)}m` : Math.abs(v) >= 1e3 ? `R${Math.round(v / 1e3)}k` : `R${Math.round(v)}`;
  if (f === "percent") return `${Math.round(v <= 1 && v >= -1 && v !== 0 ? v * 100 : v)}%`;
  if (f === "score") return `${Math.round(v)}`;
  return Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v % 1 === 0 ? v.toLocaleString("en-ZA") : v.toFixed(1);
}

export function toCSV(c: { columns: string[]; rows: unknown[][] }): string {
  const q = (v: unknown) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [c.columns.map(q).join(","), ...c.rows.map((r) => r.map(q).join(","))].join("\n");
}

export function download(name: string, data: string, type: string) {
  const a = document.createElement("a");
  a.href = data.startsWith("data:") ? data : URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click();
}

export function chartOption(c: ChartArtifact, theme: { ink: string; muted: string; line: string; panel: string }, print = false): EChartsOption {
  const xi = c.columns.indexOf(c.x);
  const yi = c.y.map((y) => c.columns.indexOf(y)).filter((i) => i >= 0);
  const rows = c.rows.slice(0, 60);
  const cats = rows.map((r) => String(r[xi] ?? "—"));
  const num = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
  // Fonts, tooltip card, grid and mark specs come from the Acolyte ECharts theme (viz.ts).
  const base: EChartsOption = {
    animation: !print,
    color: PALETTE(print),
    tooltip: { trigger: c.type === "pie" || c.type === "scatter" ? "item" : "axis", valueFormatter: (v: any) => fmt(v, c.value_format) },
    legend: yi.length > 1 ? { top: 0 } : undefined,
  };
  const valAxis = { type: "value" as const, axisLabel: { formatter: (v: number) => fmt(v, c.value_format) } };
  const label = { show: rows.length <= 16, color: theme.muted, fontSize: 10, formatter: (p: any) => fmt(Array.isArray(p.value) ? p.value[1] : p.value, c.value_format) };

  if (c.type === "pie") {
    return { ...base, legend: { bottom: 0 },
      series: [{ type: "pie", radius: ["50%", "76%"], padAngle: 1, center: ["50%", "45%"], itemStyle: { borderColor: theme.panel, borderWidth: 2 },
        label: { formatter: (p: any) => `${p.name}\n${fmt(p.value, c.value_format)}` },
        data: rows.map((r) => ({ name: String(r[xi]), value: num(r[yi[0]]) ?? 0 })) }] };
  }
  if (c.type === "scatter") {
    return { ...base, grid: { left: 10, right: 20, top: 20, bottom: 10, containLabel: true },
      xAxis: { ...valAxis, name: c.x, nameLocation: "middle", nameGap: 26 }, yAxis: { ...valAxis, name: c.y[0] },
      series: [{ type: "scatter", symbolSize: 10, data: rows.map((r) => [num(r[xi]), num(r[yi[0]])]) }] };
  }
  const horizontal = c.type === "hbar";
  const catAxis = { type: "category" as const, data: horizontal ? [...cats].reverse() : cats, axisTick: { show: false },
    axisLabel: { color: theme.ink, fontSize: 12, interval: 0, rotate: !horizontal && cats.length > 6 ? 35 : 0, width: horizontal ? 180 : 110, overflow: "truncate" as const },
  };
  const ACC = print ? "#5d7a0a" : "#c8f135", ACC2 = print ? "#3f5306" : "#8fb31f";
  const grad = (a: string, b: string, h: boolean) => ({ type: "linear", x: 0, y: 0, x2: h ? 1 : 0, y2: h ? 0 : 1,
    colorStops: [{ offset: 0, color: h ? b : a }, { offset: 1, color: h ? a : b }] });
  const series = yi.map((i, k) => {
    const data = rows.map((r) => num(r[i]));
    const t = c.type === "area" ? "line" : c.type === "hbar" ? "bar" : c.type;
    const single = yi.length === 1;
    const max = Math.max(...data.filter((v): v is number => v != null));
    const last = data.length - 1;
    let shaped: any[] = horizontal ? [...data].reverse() : data;
    if (t === "bar" && single) {
      // The leader carries the full accent and a bold label; the rest a calmer gradient, so the story pops.
      shaped = shaped.map((v) => (v === max && data.length > 2
        ? { value: v, itemStyle: { color: grad(ACC, ACC, horizontal), shadowBlur: print ? 0 : 14, shadowColor: "rgba(200,241,53,.45)" },
            label: { fontWeight: 700, color: theme.ink, fontSize: 11 } }
        : { value: v, itemStyle: { color: grad(ACC, ACC2, horizontal), opacity: data.length > 2 ? 0.78 : 1 } }));
    }
    if (t === "line") {
      // Emphasise the latest point with its value.
      shaped = shaped.map((v, j) => (j === last && v != null
        ? { value: v, symbol: "circle", symbolSize: 9, label: { show: true, position: "right", fontWeight: 700, color: theme.ink, fontSize: 11,
            formatter: (p: any) => fmt(p.value, c.value_format) } } : v));
    }
    return { name: c.y[k], type: t as "bar" | "line", data: shaped, smooth: t === "line" ? 0.25 : undefined,
      areaStyle: c.type === "area" || (t === "line" && single)
        ? { opacity: 1, color: grad(single ? (print ? "rgba(93,122,10,.22)" : "rgba(200,241,53,.28)") : "rgba(124,196,255,.12)", "rgba(0,0,0,0)", false) }
        : undefined,
      barMaxWidth: 30, barCategoryGap: "28%", showSymbol: t === "line" && rows.length < 14, symbolSize: 6,
      // One series: the brand accent (no set to separate). Several: the validated categorical order.
      itemStyle: { borderRadius: barEnd(horizontal), ...(single ? { color: ACC } : {}) },
      lineStyle: t === "line" ? { width: single ? 3 : 2.25, ...(single ? { color: ACC, shadowBlur: print ? 0 : 12, shadowColor: "rgba(200,241,53,.5)" } : {}) } : undefined,
      emphasis: { focus: "series" },
      label: { ...label, show: label.show && single && t === "bar", position: horizontal ? "right" : "top", fontSize: 11 } } as any;
  });
  if (series.length && c.annotations?.length) Object.assign(series[0], marks(c, rows, cats, xi, yi[0], horizontal, theme, print));
  const roomTop = (yi.length > 1 ? 30 : 16) + (c.annotations?.some((a) => a.kind === "point" || (a.kind === "line" && (horizontal ? a.y != null : !!a.at))) ? 26 : 0);
  return { ...base, grid: { left: 10, right: horizontal ? 64 : (c.type === "line" || c.type === "area" ? 54 : 20), top: roomTop, bottom: 10, containLabel: true },
    xAxis: horizontal ? valAxis : catAxis, yAxis: horizontal ? catAxis : valAxis, series };
}

/** ECharts markPoint / markLine / markArea for the chart's annotations (category axis = x, or y for hbar). */
function marks(c: ChartArtifact, rows: unknown[][], cats: string[], xi: number, y0: number, horizontal: boolean,
               theme: { ink: string; muted: string; line: string; panel: string }, print: boolean) {
  const catKey = horizontal ? "yAxis" : "xAxis", valKey = horizontal ? "xAxis" : "yAxis";
  const lbl = (color: string, pos: string) => ({ show: true, color: theme.ink, backgroundColor: theme.panel, borderColor: color,
    borderWidth: 1, borderRadius: 4, padding: [2, 5], fontSize: 10, position: pos });
  const points: any[] = [], lines: any[] = [], areas: any[] = [];
  for (const a of c.annotations || []) {
    const col = TONE(a.tone, print);
    if (a.kind === "point" && cats.includes(a.at)) {
      const r = rows.find((row) => String(row[xi] ?? "—") === a.at);
      const v = r ? Number(r[y0]) : null;
      const onBar = c.type === "bar" || c.type === "hbar";   // sit clear of the bar's own value label
      if (v != null && !Number.isNaN(v)) points.push({ coord: horizontal ? [v, a.at] : [a.at, v], value: a.label, itemStyle: { color: col },
        symbolOffset: onBar ? (horizontal ? [46, 0] : [0, -22]) : [0, 0],
        label: { ...lbl(col, horizontal ? "right" : "top"), formatter: a.label, offset: horizontal ? [onBar ? 54 : 8, 0] : [0, onBar ? -26 : -4] } });
    } else if (a.kind === "line") {
      const ls = { color: col, type: "dashed", width: 1.5 };
      const vertical = (a.at && !horizontal) || (!a.at && horizontal);
      if (a.at && cats.includes(a.at)) lines.push({ [catKey]: a.at, lineStyle: ls, label: { ...lbl(col, vertical ? "end" : "insideEndTop"), formatter: a.label, rotate: 0 } });
      else if (a.y != null) lines.push({ [valKey]: a.y, lineStyle: ls, label: { ...lbl(col, vertical ? "end" : "insideEndTop"), formatter: a.label, rotate: 0 } });
    } else if (a.kind === "band") {
      const st = { color: col, opacity: 0.12 };
      if (a.at && a.to && cats.includes(a.at) && cats.includes(a.to))
        areas.push([{ [catKey]: a.at, name: a.label, itemStyle: st, label: { color: theme.ink, fontSize: 10, position: "insideTop" } }, { [catKey]: a.to }]);
      else if (a.y != null && a.y_to != null)
        areas.push([{ [valKey]: a.y, name: a.label, itemStyle: st, label: { color: theme.ink, fontSize: 10, position: "insideTopLeft" } }, { [valKey]: a.y_to }]);
    }
  }
  return {
    ...(points.length ? { markPoint: { symbol: "pin", symbolSize: 34, data: points, label: { show: false } } } : {}),
    ...(lines.length ? { markLine: { symbol: ["none", "none"], silent: true, data: lines } } : {}),
    ...(areas.length ? { markArea: { silent: true, data: areas } } : {}),
  };
}
