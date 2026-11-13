/**
 * Acolyte pack layout: turns a report into slides made of simple primitives (boxes, text, charts).
 * Two renderers draw the same slides: PowerPoint (native charts) and PDF (16:9 pages), so they always match.
 *
 * Design language (consulting pack): dark header band with section label, Q-chip + action title + bold takeaway,
 * chart left / KPI cards + "So what" + note boxes right, Q&A grid, conclusions & actions, method & limits.
 */
import { fmt, human, type ChartArtifact, type Kpi, type ReportArtifact } from "./chart";

export const W = 13.333, H = 7.5, M = 0.45;
export const C = {
  ink: "0C0C0E", lime: "C8F135", olive: "5D7A0A", paper: "F5F3EE", note: "F6F9E4", muted: "6B6656", line: "E4E0D6",
  white: "FFFFFF", darkCard: "1B1B20", darkMuted: "A9A8B0", pos: "1E8E55", neg: "D2452B", neutral: "3D3D45",
};
export const TONE: Record<string, string> = { brand: C.olive, positive: C.pos, negative: C.neg, neutral: C.neutral };

export type Prim =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill: string; radius?: number }
  | { t: "text"; x: number; y: number; w: number; h: number; text: string; size: number; color: string; bold?: boolean;
      align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; min?: number; spacing?: number }
  | { t: "list"; x: number; y: number; w: number; h: number; items: string[]; size: number; color: string; numbered?: boolean;
      marker?: string; min?: number }
  | { t: "chart"; x: number; y: number; w: number; h: number; chart: ChartArtifact }
  | { t: "logo"; x: number; y: number; s: number }
  | { t: "link"; x: number; y: number; w: number; h: number; url: string };

export interface SlideSpec { bg: string; prims: Prim[] }

const clean = (s?: string) => (s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/** Approximate rendered width (inches) of text at a point size, for layout decisions. */
/** Conservative width estimate: covers Poppins and the wider fonts PowerPoint substitutes when Poppins isn't installed. */
export const approxWidth = (text: string, pt: number, bold = false) => text.length * pt * (bold ? 0.68 : 0.6) / 72;

/** Largest size (<= max, >= min) at which `text` wraps into the box. `measure` gives width in inches. */
export function fitSize(text: string, w: number, h: number, max: number, min: number,
                        measure: (s: string, pt: number) => number = approxWidth, lineGap = 1.25): number {
  for (let pt = max; pt >= min; pt -= 0.5) {
    const lines = text.split(/\n/).reduce((n, para) => {
      const words = para.split(/\s+/); let line = "", c = 1;
      for (const wd of words) {
        const t = line ? line + " " + wd : wd;
        if (measure(t, pt) > w && line) { c++; line = wd; } else line = t;
      }
      return n + c;
    }, 0);
    if (lines * pt * lineGap / 72 <= h) return pt;
  }
  return min;
}

/** Estimated height (inches) of wrapped text at a size. */
export function textHeight(text: string, w: number, pt: number, bold = false): number {
  const lines = text.split(/\n/).reduce((n, para) => {
    let line = "", c = 1;
    for (const wd of para.split(/\s+/)) { const t = line ? line + " " + wd : wd; if (approxWidth(t, pt, bold) > w && line) { c++; line = wd; } else line = t; }
    return n + c;
  }, 0);
  return lines * pt * 1.25 / 72;
}
const boxNeed = (text: string | string[], w: number) =>
  0.55 + (Array.isArray(text) ? text.reduce((a, t) => a + textHeight(t, w - 0.6, 10) + 0.08, 0) : textHeight(text, w - 0.32, 10));

// ------------------------------------------------------------------ shared chrome
function chrome(prims: Prim[], section: string, page: number, footer: string) {
  prims.push({ t: "rect", x: 0, y: 0, w: W, h: 0.42, fill: C.ink });
  prims.push({ t: "logo", x: M, y: 0.1, s: 0.22 });
  prims.push({ t: "text", x: M + 0.3, y: 0.06, w: 3, h: 0.3, text: "ACOLYTE", size: 10, bold: true, color: C.white, valign: "middle", spacing: 3 });
  prims.push({ t: "text", x: W - M - 5, y: 0.06, w: 5, h: 0.3, text: section, size: 9, color: C.darkMuted, align: "right", valign: "middle" });
  prims.push({ t: "rect", x: M, y: 7.08, w: W - 2 * M, h: 0.01, fill: C.line });
  prims.push({ t: "text", x: M, y: 7.12, w: 11, h: 0.26, text: footer, size: 7.5, color: C.muted, valign: "middle" });
  prims.push({ t: "text", x: W - M - 1, y: 7.12, w: 1, h: 0.26, text: String(page), size: 8, color: C.muted, align: "right", valign: "middle" });
}

function heading(prims: Prim[], title: string, takeaway: string, chip?: string) {
  let x = M;
  if (chip) {
    prims.push({ t: "rect", x: M, y: 0.66, w: 0.5, h: 0.34, fill: C.lime, radius: 0.06 });
    prims.push({ t: "text", x: M, y: 0.66, w: 0.5, h: 0.34, text: chip, size: 10, bold: true, color: C.ink, align: "center", valign: "middle" });
    x = M + 0.62;
  }
  prims.push({ t: "text", x, y: 0.58, w: W - x - M, h: 0.5, text: clean(title), size: 22, min: 15, bold: true, color: C.ink, valign: "middle" });
  if (takeaway) prims.push({ t: "text", x: M, y: 1.1, w: W - 2 * M, h: 0.42, text: clean(takeaway), size: 12, min: 9.5, bold: true, color: C.neutral, valign: "top" });
}

function kpiCard(prims: Prim[], k: Kpi, x: number, y: number, w: number, h: number, dark = false) {
  prims.push({ t: "rect", x, y, w, h, fill: dark ? C.darkCard : C.paper, radius: 0.06 });
  prims.push({ t: "text", x: x + 0.14, y: y + 0.1, w: w - 0.28, h: 0.24, text: clean(k.label), size: 8.5, min: 7, color: dark ? C.darkMuted : C.muted });
  const color = dark ? (k.tone === "negative" ? "FF8A70" : k.tone === "positive" ? "7FD8A2" : C.lime) : (TONE[k.tone] || C.olive);
  const v = clean(k.value), vmax = dark ? 28 : 26;
  const vsize = Math.max(11, Math.min(vmax, Math.floor((w - 0.3) * 72 / (Math.max(v.length, 1) * 0.7))));   // always one line
  prims.push({ t: "text", x: x + 0.14, y: y + 0.32, w: w - 0.28, h: Math.min(0.62, h * 0.48), text: v, size: vsize, bold: true, color, valign: "middle" });
  if (k.context) prims.push({ t: "text", x: x + 0.14, y: y + 0.32 + Math.min(0.62, h * 0.48), w: w - 0.28, h: h - 0.42 - Math.min(0.62, h * 0.48),
    text: clean(k.context), size: 8, min: 6.5, color: dark ? C.darkMuted : C.muted });
}

function box(prims: Prim[], kind: "so_what" | "note" | "plain", title: string, text: string | string[], x: number, y: number, w: number, h: number) {
  const dark = kind === "so_what";
  prims.push({ t: "rect", x, y, w, h, fill: dark ? C.ink : kind === "note" ? C.note : C.paper, radius: 0.06 });
  prims.push({ t: "text", x: x + 0.16, y: y + 0.1, w: w - 0.32, h: 0.26, text: title, size: 9.5, bold: true, color: dark ? C.lime : C.ink });
  const body = { x: x + 0.16, y: y + 0.38, w: w - 0.32, h: h - 0.48 };
  if (Array.isArray(text)) prims.push({ t: "list", ...body, items: text.map(clean), size: 10, min: 7, color: dark ? C.white : C.ink });
  else prims.push({ t: "text", ...body, text: clean(text), size: 10, min: 7, color: dark ? C.white : C.ink });
}

function chartBlock(prims: Prim[], c: ChartArtifact, x: number, y: number, w: number, h: number) {
  const title = clean(c.title), sub = clean(c.subtitle);
  const th = Math.min(textHeight(title, w, 10.5, true), 0.62) + 0.04;
  prims.push({ t: "text", x, y, w, h: th, text: title, size: 10.5, min: 8.5, bold: true, color: C.ink });
  let top = y + th;
  if (sub) {
    const sh = Math.min(textHeight(sub, w, 8), 0.4) + 0.02;
    prims.push({ t: "text", x, y: top, w, h: sh, text: sub, size: 8, min: 7, color: C.muted });
    top += sh;
  }
  top += 0.06;
  const chart = { ...c, columns: c.columns.map(human), x: human(c.x), y: c.y.map(human) };
  const ch = y + h - top;
  if (c.type === "table") {
    const tl = tableLayout(chart, w, ch - 0.22);
    if (tl.more) prims.push({ t: "text", x, y: y + h - 0.2, w, h: 0.2, text: `+${tl.more} more rows · full list in the CSV download`, size: 7.5, color: C.muted });
  }
  prims.push({ t: "chart", x, y: top, w, h: c.type === "table" ? ch - 0.22 : ch, chart });
}

export interface TableLayout { cols: string[]; widths: number[]; rows: string[][]; numeric: boolean[]; rowH: number; headH: number; pt: number; more: number }

/** Fit a table into a box: at most 6 columns, widths from content, cells truncated (never wrapped), rows trimmed. */
export function tableLayout(c: ChartArtifact, w: number, h: number): TableLayout {
  const pt = 8.5, rowH = 0.26, headH = 0.44;
  const xi = c.columns.indexOf(c.x);
  const idx = [xi, ...c.y.map((v) => c.columns.indexOf(v))].filter((i, k, a) => i >= 0 && a.indexOf(i) === k).slice(0, 6);
  const fitRows = Math.max(1, Math.floor((h - headH) / rowH));
  const src = c.rows.slice(0, fitRows);
  const cell = (v: unknown, i: number) => typeof v === "number" ? fmt(v, c.y.includes(c.columns[i]) ? c.value_format : "number") : String(v ?? "—");
  const raw = src.map((r) => idx.map((i) => cell(r[i], i)));
  const numeric = idx.map((i) => src.some((r) => typeof r[i] === "number"));
  const want = idx.map((i, k) => Math.max(
    Math.max(...c.columns[i].split(/\s+/).map((wd) => approxWidth(wd, pt, true))) + 0.12,
    Math.min(Math.max(...raw.map((r) => approxWidth(r[k], pt)), 0) + 0.12, numeric[k] ? 1.1 : 2.6)));
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map((x) => x * w / total);
  const trunc = (t: string, width: number) => {
    if (approxWidth(t, pt) <= width - 0.1) return t;
    let n = Math.max(1, Math.floor((width - 0.1) * 72 / (pt * 0.6)) - 1);
    return t.slice(0, n).trimEnd() + "…";
  };
  return { cols: idx.map((i) => c.columns[i]), widths, rows: raw.map((r) => r.map((t, k) => trunc(t, widths[k]))), numeric,
           rowH, headH, pt, more: Math.max(0, c.rows.length - src.length) };
}

// ------------------------------------------------------------------ slides
export function buildDeck(r: ReportArtifact): SlideSpec[] {
  const slides: SlideSpec[] = [];
  const date = fmtDate(r.generated || new Date().toISOString());
  const footer = `Acolyte · SA Automation Opportunity Index${r.scope ? " · " + clean(r.scope) : ""} · ${date}`;
  const exec = r.exec;
  const questions = r.questions?.length ? r.questions : r.sections.map((s) => s.question || s.title || s.heading).filter(Boolean);

  // 1. Cover
  {
    const p: Prim[] = [];
    p.push({ t: "logo", x: 0.6, y: 0.5, s: 0.34 });
    p.push({ t: "text", x: 1.05, y: 0.5, w: 3, h: 0.34, text: "ACOLYTE", size: 12, bold: true, color: C.white, valign: "middle", spacing: 3 });
    p.push({ t: "rect", x: 6.0, y: 0.5, w: 1.7, h: 0.32, fill: C.lime, radius: 0.16 });
    p.push({ t: "text", x: 6.0, y: 0.5, w: 1.7, h: 0.32, text: "LIVE DATA PACK", size: 8, bold: true, color: C.ink, align: "center", valign: "middle" });
    p.push({ t: "rect", x: 0.6, y: 1.55, w: 0.9, h: 0.07, fill: C.lime });
    p.push({ t: "text", x: 0.6, y: 1.75, w: 7.3, h: 1.7, text: clean(r.title), size: 32, min: 20, bold: true, color: C.white, valign: "top" });
    if (r.scope) p.push({ t: "text", x: 0.6, y: 3.5, w: 7.3, h: 0.5, text: clean(r.scope), size: 12, min: 9, bold: true, color: C.lime });
    const ks = (r.cover_kpis?.length ? r.cover_kpis : exec?.kpis || []).slice(0, 3);
    ks.forEach((k, i) => kpiCard(p, k, 0.6 + i * 2.48, 4.35, 2.32, 1.55, true));
    p.push({ t: "rect", x: 8.35, y: 0.5, w: 4.4, h: 6.1, fill: C.darkCard, radius: 0.08 });
    p.push({ t: "text", x: 8.6, y: 0.7, w: 4, h: 0.3, text: "QUESTIONS THIS PACK ANSWERS", size: 9, bold: true, color: C.lime, spacing: 1 });
    p.push({ t: "list", x: 8.6, y: 1.1, w: 3.95, h: 5.3, items: questions.map((q, i) => `Q${i + 1}  ${clean(q)}`), size: 11, min: 8, color: C.white, marker: "" });
    p.push({ t: "text", x: 0.6, y: 6.75, w: 7.5, h: 0.3, text: `${date} · Prepared with Acolyte Analyst · public job-ad data, not a census of employment`, size: 8, color: C.darkMuted });
    slides.push({ bg: C.ink, prims: p });
  }

  // 2. Executive summary
  if (exec && (exec.takeaway || exec.kpis?.length)) {
    const p: Prim[] = [];
    chrome(p, "Executive summary", slides.length + 1, footer);
    heading(p, exec.title ? `Executive summary: ${exec.title.replace(/^executive summary:\s*/i, "")}` : "Executive summary", exec.takeaway);
    const ks = exec.kpis.slice(0, 8);
    const cols = ks.length > 4 ? 4 : Math.max(ks.length, 1), rows = Math.ceil(ks.length / cols);
    const cw = (W - 2 * M - (cols - 1) * 0.18) / cols, chh = rows > 1 ? 1.22 : 1.5;
    ks.forEach((k, i) => kpiCard(p, k, M + (i % cols) * (cw + 0.18), 1.72 + Math.floor(i / cols) * (chh + 0.16), cw, chh));
    const yb = 1.72 + rows * (chh + 0.16) + 0.08;
    const half = (W - 2 * M - 0.2) / 2;
    const bw = exec.so_what && exec.catch ? half : W - 2 * M;
    const hb = Math.min(7.0 - yb - 0.05, Math.max(boxNeed(exec.so_what || "", bw), boxNeed(exec.catch || "", bw), 1.1));
    if (exec.so_what) box(p, "so_what", "So what", exec.so_what, M, yb, exec.catch ? half : W - 2 * M, hb);
    if (exec.catch) box(p, "note", "The catch", exec.catch, exec.so_what ? M + half + 0.2 : M, yb, exec.so_what ? half : W - 2 * M, hb);
    slides.push({ bg: C.white, prims: p });
  } else if (r.summary) {
    const p: Prim[] = [];
    chrome(p, "Executive summary", slides.length + 1, footer);
    heading(p, "Executive summary", "");
    box(p, "plain", "In short", r.summary, M, 1.3, W - 2 * M, 3.2);
    slides.push({ bg: C.white, prims: p });
  }

  // 3. One slide per question / section
  r.sections.forEach((s, i) => {
    const p: Prim[] = [];
    const label = clean(s.question || s.heading || s.title || "").split(/\s+/).slice(0, 5).join(" ");
    chrome(p, label, slides.length + 1, footer);
    heading(p, s.title || s.heading, s.takeaway || "", s.question ? `Q${i + 1}` : undefined);
    const charts = s.chart_ids.map((id) => r.charts[id]).filter(Boolean);
    const bullets = s.bullets?.length ? s.bullets : (s.body || "").split(/\n+/).map((l) => l.replace(/^[-*•]\s*/, "")).filter(Boolean);
    const kpis = (s.kpis || []).slice(0, 3);
    const top = s.takeaway ? 1.68 : 1.3, bottom = 6.98;
    const side: { kind: "kpis" | "so_what" | "note" | "bullets"; weight: number }[] = [];
    if (kpis.length) side.push({ kind: "kpis", weight: 1.15 });
    if (s.so_what) side.push({ kind: "so_what", weight: 1.4 });
    if (s.note) side.push({ kind: "note", weight: 1.15 });
    if (bullets.length && charts.length) side.push({ kind: "bullets", weight: 1.3 });

    const drawSide = (x: number, w: number) => {
      const need = side.map((it) => it.kind === "kpis" ? 1.2
        : boxNeed(it.kind === "so_what" ? s.so_what! : it.kind === "note" ? s.note! : bullets, w));
      const avail = bottom - top - 0.15 * (side.length - 1), sum = need.reduce((a, b) => a + b, 0);
      const scale = sum > avail ? avail / sum : 1;
      let y = top;
      side.forEach((it, n) => {
        const h = need[n] * scale;
        if (it.kind === "kpis") {
          const kw = (w - 0.12 * (kpis.length - 1)) / kpis.length;
          kpis.forEach((k, j) => kpiCard(p, k, x + j * (kw + 0.12), y, kw, h));
        } else if (it.kind === "so_what") box(p, "so_what", "So what", s.so_what!, x, y, w, h);
        else if (it.kind === "note") box(p, "note", "How to read it", s.note!, x, y, w, h);
        else box(p, "plain", "Detail", bullets, x, y, w, h);
        y += h + 0.15;
      });
    };

    if (charts.length === 1) {
      const cw = side.length ? 7.85 : W - 2 * M;
      chartBlock(p, charts[0], M, top, cw, bottom - top);
      if (side.length) drawSide(M + cw + 0.3, W - 2 * M - cw - 0.3);
    } else if (charts.length === 2) {
      const cw = side.length ? 4.0 : (W - 2 * M - 0.3) / 2;
      chartBlock(p, charts[0], M, top, cw, bottom - top);
      chartBlock(p, charts[1], M + cw + 0.25, top, cw, bottom - top);
      if (side.length) drawSide(M + 2 * cw + 0.55, W - 2 * M - 2 * cw - 0.55);
    } else {
      if (bullets.length) side.unshift({ kind: "bullets", weight: 1.6 });
      drawSide(M, W - 2 * M);
    }
    slides.push({ bg: C.white, prims: p });
  });

  // 4. Executive Q&A
  if (r.qa?.length) {
    const p: Prim[] = [];
    chrome(p, "Executive Q&A", slides.length + 1, footer);
    heading(p, "Executive Q&A", "The questions we expect, with the numbers behind the answers.");
    const n = r.qa.length, cols = 2, rows = Math.ceil(n / cols);
    const cw = (W - 2 * M - 0.2) / 2;
    const needQa = Math.max(...r.qa.map((x) => 0.6 + textHeight(x.q, cw - 0.32, 11, true) + textHeight(x.a, cw - 0.32, 10)), 1.0);
    const ch = Math.min((6.98 - 1.68 - (rows - 1) * 0.16) / rows, needQa + 0.1);
    r.qa.forEach((qa, i) => {
      const x = M + (i % 2) * (cw + 0.2), y = 1.68 + Math.floor(i / 2) * (ch + 0.16);
      p.push({ t: "rect", x, y, w: cw, h: ch, fill: C.paper, radius: 0.06 });
      p.push({ t: "text", x: x + 0.16, y: y + 0.12, w: cw - 0.32, h: textHeight(clean(qa.q), cw - 0.32, 11, true) + 0.05, text: clean(qa.q), size: 11, min: 8.5, bold: true, color: C.ink });
      const qh = textHeight(clean(qa.q), cw - 0.32, 11, true);
      p.push({ t: "text", x: x + 0.16, y: y + 0.18 + qh, w: cw - 0.32, h: ch - 0.28 - qh, text: clean(qa.a), size: 10, min: 7, color: C.neutral });
    });
    slides.push({ bg: C.white, prims: p });
  }

  // 5. Conclusions & recommended actions
  const co = r.conclusions || {};
  if (co.findings?.length || co.actions?.length) {
    const p: Prim[] = [];
    chrome(p, "Conclusions", slides.length + 1, footer);
    heading(p, "Conclusions and recommended actions", exec?.title || "");
    const cw = (W - 2 * M - 0.4) / 3, y = 1.72;
    const h = Math.min(6.98 - y, Math.max(boxNeed(co.findings || [], cw), boxNeed(co.risks || [], cw), boxNeed(co.actions || [], cw) + 0.2, 2.2));
    box(p, "plain", "What the data says", co.findings || [], M, y, cw, h);
    box(p, "note", "What could make this wrong", co.risks || [], M + cw + 0.2, y, cw, h);
    p.push({ t: "rect", x: M + 2 * (cw + 0.2), y, w: cw, h, fill: C.ink, radius: 0.06 });
    p.push({ t: "text", x: M + 2 * (cw + 0.2) + 0.16, y: y + 0.1, w: cw - 0.32, h: 0.26, text: "Recommended actions", size: 9.5, bold: true, color: C.lime });
    p.push({ t: "list", x: M + 2 * (cw + 0.2) + 0.16, y: y + 0.42, w: cw - 0.32, h: h - 0.55, items: (co.actions || []).map(clean), numbered: true, size: 10.5, min: 7, color: C.white });
    slides.push({ bg: C.white, prims: p });
  }

  // 6. Method & limits
  const me = r.method || {};
  if (me.steps?.length || me.limits?.length) {
    const p: Prim[] = [];
    chrome(p, "Method and limits", slides.length + 1, footer);
    heading(p, "How this was built, what to trust, and what is estimated", "Every figure comes from live SQL over public job ads; the queries are shown in Acolyte Analyst.");
    const y = 1.72, w1 = 4.6, w2 = (W - 2 * M - w1 - 0.4) / 2;
    const steps = (me.steps || []).slice(0, 5);
    const sh = Math.min((6.98 - y) / Math.max(steps.length, 1), Math.max(...steps.map((st) => textHeight(st, w1 - 0.6, 10)), 0.4) + 0.35);
    const h = Math.min(6.98 - y, Math.max(boxNeed(me.trust || [], w2), boxNeed(me.limits || [], w2), sh * steps.length));
    steps.forEach((st, i) => {
      const yy = y + i * sh;
      p.push({ t: "rect", x: M, y: yy + 0.05, w: 0.38, h: 0.38, fill: C.ink, radius: 0.19 });
      p.push({ t: "text", x: M, y: yy + 0.05, w: 0.38, h: 0.38, text: String(i + 1), size: 11, bold: true, color: C.lime, align: "center", valign: "middle" });
      p.push({ t: "text", x: M + 0.52, y: yy, w: w1 - 0.6, h: sh - 0.08, text: clean(st), size: 10, min: 7, color: C.ink, valign: "top" });
    });
    box(p, "plain", "What to trust", me.trust || [], M + w1 + 0.2, y, w2, h);
    box(p, "note", "Estimated or not comparable", me.limits || [], M + w1 + 0.4 + w2, y, w2, h);
    slides.push({ bg: C.white, prims: p });
  }

  // 7. Close
  {
    const p: Prim[] = [];
    p.push({ t: "logo", x: 0.6, y: 0.5, s: 0.34 });
    p.push({ t: "text", x: 1.05, y: 0.5, w: 3, h: 0.34, text: "ACOLYTE", size: 12, bold: true, color: C.white, valign: "middle", spacing: 3 });
    p.push({ t: "text", x: 0.6, y: 2.3, w: 11, h: 0.9, text: "Want this on your own data?", size: 34, bold: true, color: C.white });
    p.push({ t: "text", x: 0.6, y: 3.3, w: 10, h: 0.9, text: "Acolyte builds AI analysts, live dashboards and automated board packs for South African businesses, running on your own data and servers.", size: 15, color: C.darkMuted });
    p.push({ t: "rect", x: 0.6, y: 4.6, w: 3.0, h: 0.6, fill: C.lime, radius: 0.3 });
    p.push({ t: "text", x: 0.6, y: 4.6, w: 3.0, h: 0.6, text: "Talk to Acolyte →", size: 14, bold: true, color: C.ink, align: "center", valign: "middle" });
    p.push({ t: "link", x: 0.6, y: 4.6, w: 3.0, h: 0.6, url: "https://dumichanda.github.io/acolyte-site/#contact" });
    p.push({ t: "text", x: 0.6, y: 6.75, w: 9, h: 0.3, text: "dumichanda.github.io/acolyte-site", size: 9, color: C.darkMuted });
    slides.push({ bg: C.ink, prims: p });
  }
  // Final guard: nothing on a content slide may run past the footer rule.
  for (const sl of slides) {
    if (sl.bg !== C.white) continue;
    for (const p of sl.prims) {
      if ("h" in p && p.y < 7.0 && p.y + p.h > 7.02) p.h = Math.max(0.1, 7.02 - p.y);
    }
  }
  return slides;
}

/** Deck for loose charts (no report): cover + one chart slide each + close. */
export function chartsDeck(charts: ChartArtifact[], title: string): ReportArtifact {
  return {
    kind: "report", id: "charts", title, summary: "", generated: new Date().toISOString(), scope: "Charts from Acolyte Analyst",
    sections: charts.map((c) => ({ heading: c.title, title: c.title, takeaway: c.subtitle, body: "", chart_ids: [c.id] })),
    charts: Object.fromEntries(charts.map((c) => [c.id, c])),
  };
}
