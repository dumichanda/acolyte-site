/**
 * Branded downloads for Acolyte Analyst artifacts, generated in the browser (no server, nothing uploaded):
 *  - PowerPoint (.pptx) with NATIVE charts (editable in PowerPoint: data, colours, labels), tables and KPI figures
 *  - PDF report (.pdf) with the Acolyte cover band, header/footer and crisp chart images
 * Both libraries are loaded on demand, so the page itself stays light.
 */
import * as echarts from "echarts";
import { url } from "../site";
import { CATEGORICAL, registerThemes } from "../viz";
import { chartOption, fmt, type ChartArtifact, type ReportArtifact } from "./chart";

const INK = "0C0C0E", LIME = "C8F135", OLIVE = "5D7A0A", PAPER = "F3EFE6", MUTED = "6B6656", LINE = "E7E2D6", WHITE = "FFFFFF";
const PALETTE = CATEGORICAL.light.map((c) => c.replace("#", "").toUpperCase());
const FONT = "Arial";
const SITE_URL = "dumichanda.github.io/acolyte-site";

const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "acolyte";
const today = () => new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

/** Paragraphs and "- " bullet lines from a section body. */
function blocks(body: string): { bullet: boolean; text: string }[] {
  return body.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([-*•]|\d+\.)\s+(.*)$/);
    return { bullet: !!m, text: clean(m ? m[2] : l) };
  });
}

let logoCache: string | null = null;
/** Acolyte mark as a PNG data URL (rendered from the site's SVG). */
async function logoPng(size = 256): Promise<string | null> {
  if (logoCache) return logoCache;
  try {
    const svg = await (await fetch(url("/favicon.svg"))).text();
    const img = new Image();
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d")!.drawImage(img, 0, 0, size, size);
    logoCache = c.toDataURL("image/png");
    return logoCache;
  } catch {
    return null;
  }
}

/** Render a chart artifact off-screen in the light theme and return a JPEG data URL. */
function chartImage(c: ChartArtifact, w = 880, h = 480): string | null {
  if (c.type === "table" || c.type === "kpi") return null;
  registerThemes();
  const div = document.createElement("div");
  div.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px`;
  document.body.appendChild(div);
  try {
    const inst = echarts.init(div, "acolyte-light", { renderer: "canvas", width: w, height: h });
    inst.setOption(chartOption(c, { ink: "#16140f", muted: "#6b6656", line: "#e7e2d6", panel: "#ffffff" }, true));
    // JPEG keeps PDFs small (a 2x PNG chart is several MB inside a PDF)
    const data = inst.getDataURL({ type: "jpeg", pixelRatio: 3, backgroundColor: "#ffffff" });
    inst.dispose();
    return data;
  } finally {
    div.remove();
  }
}

// ---------------------------------------------------------------- number formats for native charts
function maxAbs(c: ChartArtifact): number {
  const idx = c.y.map((y) => c.columns.indexOf(y));
  return Math.max(0, ...c.rows.flatMap((r) => idx.map((i) => Math.abs(Number(r[i]) || 0))));
}
function formatCode(c: ChartArtifact): string {
  const m = maxAbs(c);
  if (c.value_format === "rand") return m >= 1e6 ? '"R"#,##0.0,,"m"' : m >= 1e4 ? '"R"#,##0,"k"' : '"R"#,##0';
  if (c.value_format === "percent") return m <= 1 ? "0%" : '0"%"';
  if (c.value_format === "score") return "0";
  return m >= 1e6 ? '#,##0.0,,"m"' : "#,##0";
}

// ---------------------------------------------------------------- PowerPoint
type Pptx = InstanceType<typeof import("pptxgenjs").default>;
type Slide = ReturnType<Pptx["addSlide"]>;

function defineMasters(pptx: Pptx, logo: string | null) {
  pptx.defineSlideMaster({
    title: "ACOLYTE_CONTENT",
    background: { color: WHITE },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.08, fill: { color: LIME } } },
      ...(logo ? [{ image: { data: logo, x: 0.5, y: 6.93, w: 0.28, h: 0.28 } }] : []),
      { text: { text: "ACOLYTE", options: { x: 0.85, y: 6.9, w: 2, h: 0.34, fontFace: FONT, fontSize: 10, bold: true, color: INK, charSpacing: 2 } } },
      { text: { text: "SA Automation Opportunity Index · Acolyte Analyst", options: { x: 2.4, y: 6.9, w: 7, h: 0.34, fontFace: FONT, fontSize: 9, color: MUTED } } },
      { line: { x: 0.5, y: 6.82, w: 12.33, h: 0, line: { color: LINE, width: 0.75 } } },
    ],
    slideNumber: { x: 12.3, y: 6.9, w: 0.6, h: 0.34, fontFace: FONT, fontSize: 9, color: MUTED, align: "right" },
  });
}

function slideTitle(s: Slide, title: string, kicker?: string) {
  s.addShape("rect", { x: 0.5, y: 0.5, w: 0.07, h: 0.62, fill: { color: LIME }, line: { color: LIME } });
  if (kicker) s.addText(kicker.toUpperCase(), { x: 0.72, y: 0.36, w: 11.5, h: 0.3, fontFace: FONT, fontSize: 10, color: OLIVE, bold: true, charSpacing: 2 });
  s.addText(title, { x: 0.72, y: kicker ? 0.6 : 0.48, w: 12, h: 0.62, fontFace: FONT, fontSize: 24, bold: true, color: INK, fit: "shrink" });
}

function addBlocks(s: Slide, items: { bullet: boolean; text: string }[], x: number, y: number, w: number, h: number) {
  if (!items.length) return;
  s.addText(items.map((b) => ({
    text: b.text,
    options: { bullet: b.bullet ? { code: "25A0" } : false, paraSpaceAfter: 8, breakLine: true, color: INK },
  })), { x, y, w, h, fontFace: FONT, fontSize: 13, valign: "top", fit: "shrink", lineSpacingMultiple: 1.1 });
}

/** Native, editable chart (or table / KPI) for one artifact. */
function addChart(_pptx: Pptx, s: Slide, c: ChartArtifact, x: number, y: number, w: number, h: number) {
  const xi = c.columns.indexOf(c.x);
  const yi = c.y.map((col) => c.columns.indexOf(col)).filter((i) => i >= 0);
  const rows = c.rows.slice(0, c.type === "table" ? 14 : 30);
  s.addText(c.title, { x, y, w, h: 0.35, fontFace: FONT, fontSize: 14, bold: true, color: INK });
  if (c.subtitle) s.addText(c.subtitle, { x, y: y + 0.33, w, h: 0.28, fontFace: FONT, fontSize: 10, color: MUTED });
  const top = y + 0.7, ch = h - 0.75;

  if (c.type === "kpi") {
    s.addText(fmt(rows[0]?.[yi[0]], c.value_format), { x, y: top + ch / 2 - 0.9, w, h: 1.3, fontFace: FONT, fontSize: 66, bold: true, color: OLIVE, align: "center" });
    s.addText(c.y[0], { x, y: top + ch / 2 + 0.4, w, h: 0.4, fontFace: FONT, fontSize: 14, color: MUTED, align: "center" });
    return;
  }
  if (c.type === "table") {
    const idx = [xi, ...yi].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
    const head = idx.map((i) => ({ text: c.columns[i], options: { bold: true, color: WHITE, fill: { color: INK } } }));
    const body = rows.map((r, k) => idx.map((i) => ({
      text: typeof r[i] === "number" ? fmt(r[i], c.y.includes(c.columns[i]) ? c.value_format : "number") : String(r[i] ?? "—"),
      options: { align: (typeof r[i] === "number" ? "right" : "left") as "right" | "left", fill: { color: k % 2 ? "FAF8F3" : WHITE } },
    })));
    s.addTable([head, ...body], { x, y: top, w, fontFace: FONT, fontSize: 10, color: INK, border: { type: "solid", pt: 0.5, color: LINE },
      autoPage: false, rowH: Math.min(0.32, ch / (body.length + 1)) });
    return;
  }

  const labels = rows.map((r) => String(r[xi] ?? "—"));
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const common = {
    x, y: top, w, h: ch, fontFace: FONT,
    chartColors: yi.length === 1 && c.type !== "pie" ? [OLIVE] : PALETTE,
    catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
    valAxisLabelFormatCode: formatCode(c), dataLabelFormatCode: formatCode(c),
    valGridLine: { color: LINE, size: 0.5 }, catGridLine: { style: "none" as const },
    catAxisLineShow: true, valAxisLineShow: false,
    showLegend: yi.length > 1 || c.type === "pie", legendPos: c.type === "pie" ? ("r" as const) : ("b" as const),
    legendFontFace: FONT, legendFontSize: 10, legendColor: INK,
    showValue: rows.length <= 12 && yi.length === 1, dataLabelColor: INK, dataLabelFontSize: 9,
  };
  if (c.type === "scatter") {
    // scatter: the first series holds the X values
    s.addChart("scatter", [
      { name: c.x, values: rows.map((r) => num(r[xi])) },
      ...yi.map((i, k) => ({ name: c.y[k], values: rows.map((r) => num(r[i])) })),
    ], { ...common, lineSize: 0, lineDataSymbolSize: 8, showValue: false });
    return;
  }
  // Horizontal bars draw the first category at the bottom, so reverse them to keep the ranking top-down.
  const ordered = c.type === "hbar" ? [...rows].reverse() : rows;
  const data = yi.map((i, k) => ({ name: c.y[k], labels: c.type === "hbar" ? [...labels].reverse() : labels,
    values: ordered.map((r) => num(r[i])) }));
  if (c.type === "pie") {
    s.addChart("doughnut", data.slice(0, 1), { ...common, holeSize: 55, showPercent: true, showValue: false, dataLabelColor: WHITE });
  } else if (c.type === "line" || c.type === "area") {
    s.addChart(c.type === "area" ? "area" : "line", data, { ...common, lineSize: 2, lineDataSymbol: "none", chartColorsOpacity: c.type === "area" ? 35 : undefined });
  } else {
    s.addChart("bar", data, { ...common, barDir: c.type === "hbar" ? "bar" : "col", barGapWidthPct: 60, dataLabelPosition: "outEnd" });
  }
  s.addText("Source: SA Automation Opportunity Index (public job ads, last 60 days). Right-click the chart → Edit Data to change it.",
    { x, y: y + h - 0.02, w, h: 0.25, fontFace: FONT, fontSize: 8, color: MUTED, italic: true });
}

function titleSlide(pptx: Pptx, logo: string | null, title: string, subtitle: string) {
  const s = pptx.addSlide();
  s.background = { color: INK };
  s.addShape("rect", { x: 0.7, y: 2.35, w: 1.2, h: 0.09, fill: { color: LIME }, line: { color: LIME } });
  if (logo) s.addImage({ data: logo, x: 0.7, y: 0.6, w: 0.5, h: 0.5 });
  s.addText("ACOLYTE", { x: 1.3, y: 0.62, w: 4, h: 0.46, fontFace: FONT, fontSize: 16, bold: true, color: WHITE, charSpacing: 3 });
  s.addText(title, { x: 0.7, y: 2.6, w: 11.5, h: 1.9, fontFace: FONT, fontSize: 40, bold: true, color: WHITE, valign: "top", fit: "shrink" });
  s.addText(subtitle, { x: 0.7, y: 4.6, w: 11.5, h: 0.5, fontFace: FONT, fontSize: 16, color: "B7B6BD" });
  s.addText(`${today()} · Prepared with Acolyte Analyst`, { x: 0.7, y: 6.6, w: 9, h: 0.4, fontFace: FONT, fontSize: 11, color: "8D8C93" });
}

function closingSlide(pptx: Pptx, logo: string | null) {
  const s = pptx.addSlide();
  s.background = { color: INK };
  if (logo) s.addImage({ data: logo, x: 0.7, y: 0.6, w: 0.5, h: 0.5 });
  s.addText("Want this on your own data?", { x: 0.7, y: 2.4, w: 11.5, h: 1, fontFace: FONT, fontSize: 36, bold: true, color: WHITE });
  s.addText("Acolyte builds AI analysts, live dashboards and automated reports for South African businesses, running on your own data.",
    { x: 0.7, y: 3.45, w: 10.5, h: 0.9, fontFace: FONT, fontSize: 16, color: "B7B6BD" });
  s.addShape("roundRect", { x: 0.7, y: 4.7, w: 3.1, h: 0.62, fill: { color: LIME }, line: { color: LIME }, rectRadius: 0.3 });
  s.addText("Talk to Acolyte →", { x: 0.7, y: 4.7, w: 3.1, h: 0.62, fontFace: FONT, fontSize: 15, bold: true, color: INK, align: "center",
    hyperlink: { url: `https://${SITE_URL}/#contact` } });
  s.addText(SITE_URL, { x: 0.7, y: 6.6, w: 9, h: 0.4, fontFace: FONT, fontSize: 11, color: "8D8C93" });
}

async function newDeck() {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Acolyte Analyst";
  pptx.company = "Acolyte";
  const logo = await logoPng();
  defineMasters(pptx, logo);
  return { pptx, logo };
}

export async function reportToPptx(r: ReportArtifact) {
  const { pptx, logo } = await newDeck();
  pptx.title = r.title;
  titleSlide(pptx, logo, r.title, "SA Automation Opportunity Index · live job-market analysis");
  const sum = pptx.addSlide({ masterName: "ACOLYTE_CONTENT" });
  slideTitle(sum, "Executive summary", "Summary");
  sum.addShape("rect", { x: 0.72, y: 1.6, w: 0.06, h: 3.4, fill: { color: LIME }, line: { color: LIME } });
  sum.addText(clean(r.summary), { x: 1.0, y: 1.5, w: 11.3, h: 3.6, fontFace: FONT, fontSize: 22, color: INK, valign: "top", fit: "shrink", lineSpacingMultiple: 1.15 });
  for (const sec of r.sections) {
    const charts = sec.chart_ids.map((id) => r.charts[id]).filter(Boolean);
    const items = blocks(sec.body);
    if (!charts.length) {
      const s = pptx.addSlide({ masterName: "ACOLYTE_CONTENT" });
      slideTitle(s, sec.heading);
      addBlocks(s, items, 0.72, 1.45, 11.8, 5.2);
    }
    charts.forEach((c, k) => {
      const s = pptx.addSlide({ masterName: "ACOLYTE_CONTENT" });
      slideTitle(s, sec.heading + (k ? " (continued)" : ""));
      if (k === 0 && items.length) {
        addBlocks(s, items, 0.72, 1.45, 4.1, 5.2);
        addChart(pptx, s, c, 5.1, 1.4, 7.75, 5.25);
      } else {
        addChart(pptx, s, c, 0.72, 1.4, 12.1, 5.25);
      }
    });
  }
  closingSlide(pptx, logo);
  await pptx.writeFile({ fileName: `${slug(r.title)}.pptx` });
}

export async function chartsToPptx(charts: ChartArtifact[], title = "Acolyte Analyst charts") {
  const { pptx, logo } = await newDeck();
  pptx.title = title;
  titleSlide(pptx, logo, charts.length === 1 ? charts[0].title : title, "SA Automation Opportunity Index · live job-market analysis");
  for (const c of charts) {
    const s = pptx.addSlide({ masterName: "ACOLYTE_CONTENT" });
    slideTitle(s, c.title, "Chart");
    addChart(pptx, s, { ...c, title: c.subtitle || "", subtitle: "" }, 0.72, 1.3, 12.1, 5.35);
  }
  closingSlide(pptx, logo);
  await pptx.writeFile({ fileName: `${slug(charts.length === 1 ? charts[0].title : title)}.pptx` });
}

// ---------------------------------------------------------------- PDF
export async function reportToPdf(r: ReportArtifact) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 16, CW = W - 2 * M;
  const logo = await logoPng();
  const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  let y = 0, page = 1;

  const footer = () => {
    doc.setDrawColor(...rgb(LINE)); doc.setLineWidth(0.3); doc.line(M, H - 14, W - M, H - 14);
    if (logo) doc.addImage(logo, "PNG", M, H - 11.5, 4.5, 4.5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...rgb(INK)); doc.text("ACOLYTE", M + 6, H - 8.2);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...rgb(MUTED));
    doc.text(`SA Automation Opportunity Index · ${SITE_URL}`, M + 22, H - 8.2);
    doc.text(String(page), W - M, H - 8.2, { align: "right" });
  };
  const newPage = () => {
    footer(); doc.addPage(); page++;
    doc.setFillColor(...rgb(LIME)); doc.rect(0, 0, W, 1.6, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...rgb(MUTED));
    doc.text(r.title, M, 9);
    y = 16;
  };
  const need = (h: number) => { if (y + h > H - 20) newPage(); };
  const para = (text: string, size: number, opts: { bold?: boolean; color?: string; indent?: number; gap?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...rgb(opts.color ?? INK));
    const lines: string[] = doc.splitTextToSize(text, CW - (opts.indent ?? 0));
    const lh = size * 0.42;
    for (const ln of lines) { need(lh); doc.text(ln, M + (opts.indent ?? 0), y); y += lh; }
    y += opts.gap ?? 2;
  };

  // Cover band
  doc.setFillColor(...rgb(INK)); doc.rect(0, 0, W, 62, "F");
  doc.setFillColor(...rgb(LIME)); doc.rect(M, 34, 18, 1.2, "F");
  if (logo) doc.addImage(logo, "PNG", M, 12, 8, 8);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(255, 255, 255); doc.text("ACOLYTE", M + 11, 17.6);
  doc.setFontSize(20);
  const titleLines: string[] = doc.splitTextToSize(r.title, CW);
  doc.text(titleLines.slice(0, 2), M, 44);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(183, 182, 189);
  doc.text(`${today()} · Prepared with Acolyte Analyst`, M, 57);
  y = 74;

  // Executive summary box
  doc.setFont("helvetica", "normal"); doc.setFontSize(11.5);
  const sumLines: string[] = doc.splitTextToSize(clean(r.summary), CW - 10);
  const boxH = sumLines.length * 5 + 8;
  doc.setFillColor(...rgb(PAPER)); doc.rect(M, y - 5, CW, boxH, "F");
  doc.setFillColor(...rgb(OLIVE)); doc.rect(M, y - 5, 1.4, boxH, "F");
  doc.setTextColor(...rgb(INK)); doc.text(sumLines, M + 6, y + 1);
  y += boxH + 6;

  for (const sec of r.sections) {
    need(16);
    para(sec.heading, 14, { bold: true, gap: 3 });
    for (const b of blocks(sec.body)) {
      if (b.bullet) {
        need(5); doc.setFillColor(...rgb(OLIVE)); doc.rect(M + 1, y - 2.4, 1.6, 1.6, "F");
        para(b.text, 10, { indent: 5, gap: 1.2 });
      } else para(b.text, 10, { gap: 2.5 });
    }
    for (const id of sec.chart_ids) {
      const c = r.charts[id];
      if (!c) continue;
      const img = chartImage(c);
      const ch = img ? (CW * 480) / 880 : 0;
      need(18 + (img ? ch : 20));
      y += 3;
      para(c.title, 11, { bold: true, gap: 1 });
      if (c.subtitle) para(c.subtitle, 8.5, { color: MUTED, gap: 1.5 });
      if (img) { doc.addImage(img, "JPEG", M, y, CW, ch, undefined, "FAST"); y += ch + 3; }
      else {
        const xi = c.columns.indexOf(c.x), idx = [xi, ...c.y.map((v) => c.columns.indexOf(v))].filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
        if (c.type === "kpi") para(fmt(c.rows[0]?.[idx[1] ?? idx[0]], c.value_format), 28, { bold: true, color: OLIVE });
        else {
          const colW = CW / idx.length;
          doc.setFillColor(...rgb(INK)); doc.rect(M, y - 4, CW, 6, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
          idx.forEach((i, k) => doc.text(String(c.columns[i]).slice(0, 28), M + k * colW + 1.5, y));
          y += 6; doc.setFont("helvetica", "normal"); doc.setTextColor(...rgb(INK));
          c.rows.slice(0, 20).forEach((row) => {
            need(5.5);
            idx.forEach((i, k) => doc.text((typeof row[i] === "number" ? fmt(row[i], c.y.includes(c.columns[i]) ? c.value_format : "number") : String(row[i] ?? "—")).slice(0, 34), M + k * colW + 1.5, y));
            doc.setDrawColor(...rgb(LINE)); doc.line(M, y + 1.6, W - M, y + 1.6); y += 5.5;
          });
          y += 3;
        }
      }
      para("Source: SA Automation Opportunity Index (public job ads, last 60 days).", 7.5, { color: MUTED, gap: 5 });
    }
    y += 2;
  }
  footer();
  doc.save(`${slug(r.title)}.pdf`);
}
