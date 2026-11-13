/**
 * Acolyte chart design system for ECharts.
 *
 * Colours are validated with the dataviz palette checker (scripts/validate_palette.js), not eyeballed:
 *  - CATEGORICAL: fixed order, never cycled. Dark set passes every check on #141417;
 *    light set passes on white (aqua/amber sit under 3:1, so charts using them keep labels or a table view).
 *  - SCORE ramp: one hue (lime), light->dark, for the automation score (an ordered magnitude).
 * Mark specs: bars <= 24px with a 4px rounded data-end, 2px lines, >= 8px markers with a 2px surface ring,
 * area = 10% wash, solid hairline grid, text in ink tokens (never the series colour).
 */
import * as echarts from "echarts";

export type Mode = "dark" | "light";

export const CATEGORICAL: Record<Mode, string[]> = {
  dark: ["#7f9f14", "#3987e5", "#d95926", "#199e70", "#9085e9", "#c98500"],
  light: ["#5d7a0a", "#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#eda100"],
};

/** Automation-score ramp (low -> high). The top dark step is the brand lime. */
export const SCORE_RAMP: Record<Mode, string[]> = {
  dark: ["#5b6f1c", "#76921a", "#93b51c", "#aed420", "#c8f135"],
  light: ["#9cb83a", "#7f9c22", "#647f12", "#4b630a", "#344606"],
};
/** Continuous version for heatmaps: the low end may recede into the surface. */
export const HEAT_RAMP: Record<Mode, string[]> = {
  dark: ["#23261a", "#3d4a17", "#5b6f1c", "#93b51c", "#c8f135"],
  light: ["#eef3dc", "#cfe08f", "#9cb83a", "#647f12", "#344606"],
};
export const NEUTRAL: Record<Mode, string> = { dark: "#55545c", light: "#b9b5a8" };

export const mode = (): Mode => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

/** Score 0-100 -> ramp step (20-point bands). */
export function scoreColor(score: number, m: Mode = mode()): string {
  const r = SCORE_RAMP[m];
  return r[Math.max(0, Math.min(r.length - 1, Math.floor((score - 20) / 15)))];
}

/** Near-black or white text for a label sitting inside a coloured fill. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? "#0c0c0e" : "#ffffff";
}

const TOKENS = {
  dark: { surface: "#141417", ink: "#ecebe6", ink2: "#b7b6bd", muted: "#8d8c93", grid: "#ffffff14", axis: "#ffffff24", tipBg: "#1c1c21f2", tipBorder: "#ffffff1f" },
  light: { surface: "#ffffff", ink: "#16140f", ink2: "#3c3a33", muted: "#6b6656", grid: "#ebe7dd", axis: "#d9d4c7", tipBg: "#fffffff5", tipBorder: "#e7e2d6" },
};
export const tokens = (m: Mode = mode()) => TOKENS[m];

function theme(m: Mode) {
  const t = TOKENS[m];
  const font = '"Inter Tight", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
  const axisCommon = {
    axisLine: { show: true, lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, fontFamily: font },
    splitLine: { show: false, lineStyle: { color: t.grid, width: 1, type: "solid" } },
    nameTextStyle: { color: t.muted, fontSize: 11 },
  };
  return {
    color: CATEGORICAL[m],
    backgroundColor: "transparent",
    textStyle: { fontFamily: font, color: t.ink },
    title: { textStyle: { color: t.ink, fontWeight: 600, fontSize: 14 }, subtextStyle: { color: t.muted } },
    legend: { textStyle: { color: t.ink2, fontSize: 12 }, icon: "roundRect", itemWidth: 10, itemHeight: 10, itemGap: 16 },
    tooltip: {
      backgroundColor: t.tipBg, borderColor: t.tipBorder, borderWidth: 1, padding: [10, 12],
      textStyle: { color: t.ink, fontSize: 12, fontFamily: font },
      extraCssText: `border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,${m === "dark" ? 0.45 : 0.12});backdrop-filter:blur(8px);`,
      axisPointer: { lineStyle: { color: t.axis, width: 1 }, crossStyle: { color: t.axis }, shadowStyle: { color: m === "dark" ? "#ffffff08" : "#0000000a" } },
    },
    categoryAxis: axisCommon,
    valueAxis: { ...axisCommon, axisLine: { show: false }, splitLine: { show: true, lineStyle: { color: t.grid, width: 1, type: "solid" } } },
    timeAxis: axisCommon,
    bar: { barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } },
    line: { lineStyle: { width: 2, cap: "round", join: "round" }, symbolSize: 8, symbol: "circle", smooth: 0.25, showSymbol: false,
      itemStyle: { borderColor: t.surface, borderWidth: 2 }, emphasis: { scale: 1.2 } },
    scatter: { symbolSize: 9, itemStyle: { borderColor: t.surface, borderWidth: 2, opacity: 0.9 } },
    pie: { itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { color: t.ink2 } },
    heatmap: { itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 } },
    visualMap: { textStyle: { color: t.muted } },
    animationDuration: 700, animationEasing: "cubicOut", animationDurationUpdate: 400,
  };
}

let registered = false;
export function registerThemes() {
  if (registered) return;
  echarts.registerTheme("acolyte-dark", theme("dark"));
  echarts.registerTheme("acolyte-light", theme("light"));
  registered = true;
}
registerThemes();

export const themeName = (m: Mode = mode()) => `acolyte-${m}`;

/** Bar data-end radius for horizontal or vertical bars (square at the baseline). */
export const barEnd = (horizontal: boolean) => (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]);

/** 10% area wash in the series colour. */
export const wash = (hex: string) => ({ color: hex, opacity: 0.1 });

/** Compact axis ticks: 0 / 1,000 / 20K / 1.2M. */
export const tick = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString("en-ZA"));

/** Inline style for a score chip: ramp fill + legible ink. */
export const scoreChip = (score: number) => { const c = scoreColor(score); return { background: c, color: inkOn(c) }; };
