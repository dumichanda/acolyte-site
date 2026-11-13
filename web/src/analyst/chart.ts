import type { EChartsOption } from "echarts";

export interface ChartArtifact {
  kind: "chart"; id: string; dataset_id: string; type: string; x: string; y: string[];
  title: string; subtitle: string; value_format: string; columns: string[]; rows: unknown[][]; sql: string;
}
export interface ReportArtifact {
  kind: "report"; id: string; title: string; summary: string; generated: string;
  sections: { heading: string; body: string; chart_ids: string[] }[];
  charts: Record<string, ChartArtifact>;
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
  const catAxis = { type: "category" as const, data: horizontal ? [...cats].reverse() : cats,
    axisLabel: { color: theme.ink, fontSize: 11, interval: 0, rotate: !horizontal && cats.length > 6 ? 35 : 0, width: horizontal ? 180 : 110, overflow: "truncate" as const },
  };
  const series = yi.map((i, k) => {
    const data = rows.map((r) => num(r[i]));
    const t = c.type === "area" ? "line" : c.type === "hbar" ? "bar" : c.type;
    return { name: c.y[k], type: t as "bar" | "line", data: horizontal ? [...data].reverse() : data, smooth: t === "line" ? 0.2 : undefined,
      areaStyle: c.type === "area" || (t === "line" && yi.length === 1) ? { opacity: 0.1 } : undefined, barMaxWidth: 24, showSymbol: rows.length < 40,
      // One series: the brand accent (no set to separate). Several: the validated categorical order.
      itemStyle: { borderRadius: barEnd(horizontal), ...(yi.length === 1 ? { color: print ? "#5d7a0a" : "#c8f135" } : {}) },
      lineStyle: yi.length === 1 ? { color: print ? "#5d7a0a" : "#c8f135" } : undefined, label: { ...label, show: label.show && yi.length === 1, position: horizontal ? "right" : "top" } } as any;
  });
  return { ...base, grid: { left: 10, right: horizontal ? 60 : 20, top: yi.length > 1 ? 30 : 16, bottom: 10, containLabel: true },
    xAxis: horizontal ? valAxis : catAxis, yAxis: horizontal ? catAxis : valAxis, series };
}
