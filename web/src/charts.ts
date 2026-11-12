import type { EChartsOption } from "echarts";
import type { Family, HeatCell, Province, TrendPoint } from "./types";
import { rands } from "./types";

export interface Theme { ink: string; muted: string; line: string; accent: string; teal: string; panel: string }

export function readTheme(): Theme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return { ink: v("--ink"), muted: v("--muted"), line: v("--line"), accent: v("--accent"), teal: v("--teal"), panel: v("--panel") };
}

export const scoreColor = (s: number) =>
  s >= 65 ? "#c8f135" : s >= 50 ? "#7cc4ff" : s >= 35 ? "#ffb86b" : "#8d8c93";

const SHORT: Record<string, string> = {
  "Office & Admin Support": "Office admin", "Customer Service & Call Centre": "Call centre",
  "Creditors & Debtors": "Creditors/Debtors", "Bookkeeping & Accounts Admin": "Bookkeeping",
  "Sales Admin & Quoting": "Sales admin", "Logistics & Stock Admin": "Logistics", "Claims Administration": "Claims",
  "Reporting & Data Analysis": "Reporting", "Compliance & FICA": "FICA/Compliance",
  "Conveyancing & Legal Admin": "Legal admin", "HR & Recruitment Admin": "HR admin", "Tender Administration": "Tenders",
};

const SCORE_RANGE = ["#3a3a42", "#4d5e22", "#7fa315", "#a8d12a", "#c8f135"];

const base = (t: Theme): EChartsOption => ({
  textStyle: { fontFamily: "Inter, system-ui, sans-serif", color: t.ink },
  tooltip: { backgroundColor: t.panel, borderColor: t.line, textStyle: { color: t.ink } },
  animationDuration: 600,
});

export function familyBar(data: Family[], t: Theme, selected: string | null): EChartsOption {
  const rows = [...data].sort((a, b) => a.value - b.value);
  return {
    ...base(t),
    grid: { left: 16, right: 70, top: 6, bottom: 6, containLabel: true },
    tooltip: {
      ...base(t).tooltip as object,
      formatter: (p: any) => {
        const f = rows[p.dataIndex];
        return `<b>${f.family}</b><br/>${f.jobs} roles · score ${f.avg_score}/100<br/>Automatable value ${rands(f.value)}/yr<br/><span style="opacity:.7">${f.service}</span>`;
      },
    },
    xAxis: { type: "value", show: false },
    yAxis: {
      type: "category", data: rows.map((r) => r.family),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: t.ink, fontSize: 12 },
    },
    series: [{
      type: "bar", barWidth: "62%",
      data: rows.map((r) => ({
        value: r.value,
        itemStyle: {
          color: scoreColor(r.avg_score), borderRadius: [0, 6, 6, 0],
          opacity: selected && selected !== r.family ? 0.25 : 1,
        },
      })),
      label: { show: true, position: "right", color: t.muted, fontSize: 11, formatter: (p: any) => rands(p.value) },
    }],
  };
}

export function heatmap(cells: HeatCell[], families: string[], provinces: string[], t: Theme): EChartsOption {
  const fx = new Map(families.map((f, i) => [f, i]));
  const py = new Map(provinces.map((p, i) => [p, i]));
  const data = cells.filter((c) => fx.has(c.family) && py.has(c.province))
    .map((c) => [fx.get(c.family)!, py.get(c.province)!, c.avg_score, c.jobs]);
  return {
    ...base(t),
    grid: { left: 8, right: 8, top: 8, bottom: 52, containLabel: true },
    tooltip: {
      ...base(t).tooltip as object,
      formatter: (p: any) => `<b>${families[p.data[0]]}</b> · ${provinces[p.data[1]]}<br/>${p.data[3]} roles · avg score ${p.data[2]}/100`,
    },
    xAxis: {
      type: "category", data: families, splitArea: { show: false },
      axisLabel: { color: t.muted, fontSize: 10, rotate: 35, interval: 0, formatter: (v: string) => SHORT[v] ?? v },
      axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: { type: "category", data: provinces, axisLabel: { color: t.ink, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    visualMap: {
      min: 20, max: 90, dimension: 2, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 10,
      text: ["more automatable", "less"], textStyle: { color: t.muted, fontSize: 11 }, inRange: { color: SCORE_RANGE },
      calculable: false,
    },
    series: [{
      type: "heatmap", data,
      label: { show: true, color: "#fff", textBorderColor: "#0c0c0e", textBorderWidth: 2, fontSize: 10, formatter: (p: any) => String(p.data[3]) },
      itemStyle: { borderColor: t.panel, borderWidth: 2, borderRadius: 4 },
      emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
    }],
  };
}

export function provinceBar(data: Province[], t: Theme, selected: string | null): EChartsOption {
  const rows = [...data].sort((a, b) => a.jobs - b.jobs);
  return {
    ...base(t),
    grid: { left: 8, right: 40, top: 6, bottom: 6, containLabel: true },
    tooltip: { ...base(t).tooltip as object, formatter: (p: any) => {
      const r = rows[p.dataIndex];
      return `<b>${r.province}</b><br/>${r.jobs} roles · avg score ${r.avg_score}<br/>${rands(r.value)}/yr automatable`;
    } },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: rows.map((r) => r.province), axisLabel: { color: t.ink, fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{
      type: "bar", barWidth: "60%",
      data: rows.map((r) => ({ value: r.jobs, itemStyle: { color: t.accent, borderRadius: [0, 6, 6, 0], opacity: selected && selected !== r.province ? 0.25 : 1 } })),
      label: { show: true, position: "right", color: t.muted, fontSize: 11 },
    }],
  };
}

export function trend(data: TrendPoint[], t: Theme): EChartsOption {
  return {
    ...base(t),
    grid: { left: 8, right: 8, top: 34, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, textStyle: { color: t.muted }, icon: "roundRect", itemWidth: 12, itemHeight: 8 },
    tooltip: { ...base(t).tooltip as object, trigger: "axis" },
    xAxis: {
      type: "category", data: data.map((d) => d.day),
      axisLabel: { color: t.muted, fontSize: 11, formatter: (v: string) => new Date(v).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) },
      axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false },
    },
    yAxis: { type: "value", splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, fontSize: 11 } },
    series: [
      { name: "All new roles", type: "bar", data: data.map((d) => d.jobs), itemStyle: { color: "#8d8c9355", borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 },
      { name: "High-potential roles (score 60+)", type: "line", smooth: true, symbol: "none", data: data.map((d) => d.high_jobs), lineStyle: { width: 3, color: t.accent }, itemStyle: { color: t.accent }, areaStyle: { color: t.accent, opacity: 0.08 } },
    ],
  };
}

export function scoreDist(data: { bucket: number; jobs: number }[], t: Theme): EChartsOption {
  const buckets = Array.from({ length: 10 }, (_, i) => i + 1);
  const m = new Map(data.map((d) => [Math.min(d.bucket, 10), d.jobs]));
  return {
    ...base(t),
    grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
    tooltip: { ...base(t).tooltip as object, trigger: "axis" },
    xAxis: { type: "category", data: buckets.map((b) => `${(b - 1) * 10}–${b * 10}`), axisLabel: { color: t.muted, fontSize: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.line } } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: t.line } }, axisLabel: { color: t.muted, fontSize: 11 } },
    series: [{ type: "bar", data: buckets.map((b) => ({ value: m.get(b) ?? 0, itemStyle: { color: scoreColor((b - 0.5) * 10), borderRadius: [4, 4, 0, 0] } })) }],
  };
}
