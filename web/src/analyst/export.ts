/**
 * Branded downloads for Acolyte Analyst, generated in the browser (no server, nothing uploaded).
 * deck.ts lays out the slides once; this file draws them twice:
 *  - PowerPoint (.pptx): NATIVE charts (right-click -> Edit Data), native tables, editable text boxes
 *  - PDF (.pdf): the same 16:9 pages with Poppins embedded and crisp chart images
 * Both libraries load on demand, so the page itself stays light.
 */
import * as echarts from "echarts";
import { url } from "../site";
import { CATEGORICAL, registerThemes } from "../viz";
import { chartOption, fmt, type ChartArtifact, type ReportArtifact } from "./chart";
import { approxWidth, buildDeck, C, chartsDeck, fitSize, H, tableLayout, W, type Prim, type SlideSpec } from "./deck";

const PALETTE = CATEGORICAL.light.map((c) => c.replace("#", "").toUpperCase());
const FONT = "Poppins";   // brand font: embedded in PDFs; PowerPoint shows it where Poppins is installed (free, Google Fonts)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "acolyte";

const fontCache: Record<string, string> = {};
/** Poppins TTF as base64 (self-hosted under /fonts, SIL Open Font License). */
async function fontB64(file: string): Promise<string | null> {
  if (fontCache[file]) return fontCache[file];
  try {
    const buf = new Uint8Array(await (await fetch(url(`/fonts/${file}`))).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return (fontCache[file] = btoa(bin));
  } catch {
    return null;
  }
}

/** Make Poppins available to the canvas so chart images are drawn in it. */
async function loadWebPoppins() {
  try {
    if ([...document.fonts].some((f) => f.family.replace(/"/g, "") === "Poppins")) return;
    for (const [file, weight] of [["Poppins-Regular.ttf", "400"], ["Poppins-Bold.ttf", "700"]]) {
      const face = new FontFace("Poppins", `url(${url(`/fonts/${file}`)})`, { weight });
      document.fonts.add(await face.load());
    }
  } catch { /* fall back to the theme font */ }
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
    inst.setOption({ ...chartOption(c, { ink: "#16140f", muted: "#6b6656", line: "#e7e2d6", panel: "#ffffff" }, true),
      textStyle: { fontFamily: "Poppins, Arial, sans-serif", color: "#16140f" } });
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

// ---------------------------------------------------------------- PowerPoint renderer
type Pptx = InstanceType<typeof import("pptxgenjs").default>;
type Slide = ReturnType<Pptx["addSlide"]>;

function nativeChart(s: Slide, c: ChartArtifact, x: number, y: number, w: number, h: number) {
  const xi = c.columns.indexOf(c.x);
  const yi = c.y.map((col) => c.columns.indexOf(col)).filter((i) => i >= 0);
  const rows = c.rows.slice(0, c.type === "table" ? 16 : 30);
  if (c.type === "kpi") {
    s.addText(fmt(rows[0]?.[yi[0]], c.value_format), { x, y, w, h: h * 0.6, fontFace: FONT, fontSize: 60, bold: true, color: C.olive, align: "center", valign: "bottom" });
    s.addText(c.y[0], { x, y: y + h * 0.6, w, h: 0.4, fontFace: FONT, fontSize: 13, color: C.muted, align: "center" });
    return;
  }
  if (c.type === "table") {
    const tl = tableLayout(c, w, h);
    const head = tl.cols.map((t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.ink }, valign: "bottom" as const } }));
    const body = tl.rows.map((r, k) => r.map((t, j) => ({ text: t,
      options: { align: (tl.numeric[j] ? "right" : "left") as "right" | "left", fill: { color: k % 2 ? "FAF8F3" : C.white } } })));
    s.addTable([head, ...body], { x, y, w, colW: tl.widths, rowH: [tl.headH, ...tl.rows.map(() => tl.rowH)], fontFace: FONT, fontSize: tl.pt,
      color: C.ink, border: { type: "solid", pt: 0.5, color: C.line }, autoPage: false, margin: [0.02, 0.05, 0.02, 0.05] });
    return;
  }
  const labels = rows.map((r) => String(r[xi] ?? "—"));
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  const many = rows.length > 20;
  const common = {
    x, y, w, h, fontFace: FONT,
    chartColors: yi.length === 1 && c.type !== "pie" ? [C.olive] : PALETTE,
    catAxisLabelColor: C.neutral, valAxisLabelColor: C.muted, catAxisLabelFontSize: 9, valAxisLabelFontSize: 8,
    catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
    valAxisLabelFormatCode: formatCode(c), dataLabelFormatCode: formatCode(c),
    valGridLine: { color: C.line, size: 0.5 }, catGridLine: { style: "none" as const },
    catAxisLineShow: true, valAxisLineShow: false, catAxisLineColor: C.line,
    showLegend: yi.length > 1 || c.type === "pie", legendPos: c.type === "pie" ? ("r" as const) : ("b" as const),
    legendFontFace: FONT, legendFontSize: 9, legendColor: C.ink,
    showValue: !many && c.type !== "line" && c.type !== "area", dataLabelColor: C.ink, dataLabelFontSize: 8, dataLabelFontFace: FONT,
  };
  if (c.type === "scatter") {
    s.addChart("scatter", [{ name: c.x, values: rows.map((r) => num(r[xi])) },
      ...yi.map((i, k) => ({ name: c.y[k], values: rows.map((r) => num(r[i])) }))], { ...common, lineSize: 0, lineDataSymbolSize: 8, showValue: false });
    return;
  }
  const ordered = c.type === "hbar" ? [...rows].reverse() : rows;
  const data = yi.map((i, k) => ({ name: c.y[k], labels: c.type === "hbar" ? [...labels].reverse() : labels, values: ordered.map((r) => num(r[i])) }));
  if (c.type === "pie") s.addChart("doughnut", data.slice(0, 1), { ...common, holeSize: 58, showPercent: true, showValue: false,
    dataLabelColor: C.white, dataLabelFormatCode: "0%", dataLabelFontSize: 9 });
  else if (c.type === "line" || c.type === "area")
    s.addChart(c.type, data, { ...common, lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 5, chartColorsOpacity: c.type === "area" ? 30 : undefined });
  else s.addChart("bar", data, { ...common, barDir: c.type === "hbar" ? "bar" : "col", barGapWidthPct: 45, dataLabelPosition: "outEnd",
    valAxisHidden: c.type === "hbar" && !many, valGridLine: c.type === "hbar" && !many ? { style: "none" as const } : common.valGridLine });
}

function drawPptx(pptx: Pptx, spec: SlideSpec, logo: string | null) {
  const s = pptx.addSlide();
  s.background = { color: spec.bg };
  for (const p of spec.prims) {
    if (p.t === "rect") {
      s.addShape(p.radius ? "roundRect" : "rect", { x: p.x, y: p.y, w: p.w, h: p.h, fill: { color: p.fill }, line: { color: p.fill, width: 0 },
        ...(p.radius ? { rectRadius: p.radius } : {}) });
    } else if (p.t === "text") {
      const size = p.min ? fitSize(p.text, p.w, p.h, p.size, p.min, (t, pt) => approxWidth(t, pt, p.bold)) : p.size;
      s.addText(p.text, { x: p.x, y: p.y, w: p.w, h: p.h, fontFace: FONT, fontSize: size, bold: !!p.bold, color: p.color,
        align: p.align || "left", valign: p.valign || "top", margin: 0, charSpacing: p.spacing, lineSpacingMultiple: 1.05 });
    } else if (p.t === "list") {
      if (!p.items.length) continue;
      const size = fitSize(p.items.join("\n"), p.w - 0.25, p.h - p.items.length * 0.06, p.size, p.min || 7);
      s.addText(p.items.map((it) => ({ text: it, options: {
        bullet: p.marker === "" ? false : p.numbered ? { type: "number" as const } : { code: "25A0" },
        breakLine: true, paraSpaceAfter: 5 } })),
      { x: p.x, y: p.y, w: p.w, h: p.h, fontFace: FONT, fontSize: size, color: p.color, valign: "top", margin: 0, lineSpacingMultiple: 1.05 });
    } else if (p.t === "chart") nativeChart(s, p.chart, p.x, p.y, p.w, p.h);
    else if (p.t === "logo" && logo) s.addImage({ data: logo, x: p.x, y: p.y, w: p.s, h: p.s });
    else if (p.t === "link") s.addText(" ", { x: p.x, y: p.y, w: p.w, h: p.h, hyperlink: { url: p.url } });
  }
}

async function toPptx(r: ReportArtifact) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "ACOLYTE_16x9", width: W, height: H });
  pptx.layout = "ACOLYTE_16x9";
  pptx.author = "Acolyte Analyst"; pptx.company = "Acolyte"; pptx.title = r.title;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  const logo = await logoPng();
  for (const spec of buildDeck(r)) drawPptx(pptx, spec, logo);
  await pptx.writeFile({ fileName: `${slug(r.title)}.pptx` });
}

export const reportToPptx = (r: ReportArtifact) => toPptx(r);
export const chartsToPptx = (charts: ChartArtifact[], title = "Acolyte Analyst charts") =>
  toPptx(chartsDeck(charts, charts.length === 1 ? charts[0].title : title));

// ---------------------------------------------------------------- PDF renderer (same slides, 16:9 pages)
export async function reportToPdf(r: ReportArtifact) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "in", format: [W, H], compress: true });
  await loadWebPoppins();
  let PF = "helvetica";
  const [reg, bold] = await Promise.all([fontB64("Poppins-Regular.ttf"), fontB64("Poppins-Bold.ttf")]);
  if (reg && bold) {
    doc.addFileToVFS("Poppins-Regular.ttf", reg); doc.addFont("Poppins-Regular.ttf", "Poppins", "normal");
    doc.addFileToVFS("Poppins-Bold.ttf", bold); doc.addFont("Poppins-Bold.ttf", "Poppins", "bold");
    PF = "Poppins";
  }
  const logo = await logoPng();
  const hex = (h: string): [number, number, number] => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const measure = (b: boolean) => (t: string, pt: number) => { doc.setFont(PF, b ? "bold" : "normal"); doc.setFontSize(pt); return doc.getTextWidth(t); };

  const drawText = (text: string, x: number, y: number, w: number, h: number, size: number, color: string, b = false,
                    align: "left" | "center" | "right" = "left", valign = "top", min?: number) => {
    const pt = min ? fitSize(text, w, h, size, min, measure(b)) : size;
    doc.setFont(PF, b ? "bold" : "normal"); doc.setFontSize(pt); doc.setTextColor(...hex(color));
    const lines: string[] = text.split("\n").flatMap((para) => doc.splitTextToSize(para, w));
    const lh = pt * 1.22 / 72, total = lines.length * lh;
    let yy = valign === "middle" ? y + (h - total) / 2 : valign === "bottom" ? y + h - total : y;
    for (const ln of lines) {
      if (yy + lh > y + h + 0.05) break;
      const xx = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
      doc.text(ln, xx, yy + pt * 0.92 / 72, { align });
      yy += lh;
    }
  };

  const drawTable = (c: ChartArtifact, x: number, y: number, w: number, h: number) => {
    const tl = tableLayout(c, w, h);
    doc.setFillColor(...hex(C.ink)); doc.rect(x, y, w, tl.headH, "F");
    let xx = x;
    tl.cols.forEach((t, k) => { drawText(t, xx + 0.05, y, tl.widths[k] - 0.1, tl.headH, tl.pt, C.white, true, tl.numeric[k] ? "right" : "left", "bottom", 7); xx += tl.widths[k]; });
    tl.rows.forEach((row, n) => {
      const yy = y + tl.headH + n * tl.rowH;
      if (n % 2) { doc.setFillColor(250, 248, 243); doc.rect(x, yy, w, tl.rowH, "F"); }
      let cx = x;
      row.forEach((t, k) => { drawText(t, cx + 0.05, yy, tl.widths[k] - 0.1, tl.rowH, tl.pt, C.ink, false, tl.numeric[k] ? "right" : "left", "middle"); cx += tl.widths[k]; });
    });
  };

  buildDeck(r).forEach((spec, n) => {
    if (n) doc.addPage([W, H], "landscape");
    doc.setFillColor(...hex(spec.bg)); doc.rect(0, 0, W, H, "F");
    for (const p of spec.prims as Prim[]) {
      if (p.t === "rect") {
        doc.setFillColor(...hex(p.fill));
        if (p.radius) doc.roundedRect(p.x, p.y, p.w, p.h, p.radius, p.radius, "F"); else doc.rect(p.x, p.y, p.w, p.h, "F");
      } else if (p.t === "text") {
        if (p.spacing) doc.setCharSpace(p.spacing / 100);
        drawText(p.text, p.x, p.y, p.w, p.h, p.size, p.color, p.bold, p.align, p.valign, p.min);
        if (p.spacing) doc.setCharSpace(0);
      } else if (p.t === "list") {
        if (!p.items.length) continue;
        const pt = fitSize(p.items.join("\n"), p.w - 0.25, p.h - p.items.length * 0.06, p.size, p.min || 7, measure(false));
        doc.setFont(PF, "normal"); doc.setFontSize(pt);
        const lh = pt * 1.22 / 72; let yy = p.y;
        p.items.forEach((it, i) => {
          const indent = p.marker === "" ? 0 : 0.22;
          const lines: string[] = doc.splitTextToSize(it, p.w - indent);
          if (yy + lh > p.y + p.h) return;
          if (p.numbered) drawText(`${i + 1}.`, p.x, yy, 0.22, lh, pt, p.color === C.white ? C.lime : C.olive, true);
          else if (p.marker !== "") { doc.setFillColor(...hex(p.color === C.white ? C.lime : C.olive)); doc.rect(p.x + 0.02, yy + lh * 0.38, 0.07, 0.07, "F"); }
          doc.setFont(PF, "normal"); doc.setFontSize(pt); doc.setTextColor(...hex(p.color));
          for (const ln of lines) { if (yy + lh > p.y + p.h + 0.05) break; doc.text(ln, p.x + indent, yy + pt * 0.92 / 72); yy += lh; }
          yy += pt * 0.45 / 72;
        });
      } else if (p.t === "chart") {
        if (p.chart.type === "table") drawTable(p.chart, p.x, p.y, p.w, p.h);
        else if (p.chart.type === "kpi") {
          const yi = p.chart.columns.indexOf(p.chart.y[0]);
          drawText(fmt(p.chart.rows[0]?.[yi], p.chart.value_format), p.x, p.y, p.w, p.h * 0.6, 54, C.olive, true, "center", "bottom");
        } else {
          const img = chartImage(p.chart, Math.round(p.w * 100), Math.round(p.h * 100));
          if (img) doc.addImage(img, "JPEG", p.x, p.y, p.w, p.h, undefined, "FAST");
        }
      } else if (p.t === "logo" && logo) doc.addImage(logo, "PNG", p.x, p.y, p.s, p.s);
      else if (p.t === "link") doc.link(p.x, p.y, p.w, p.h, { url: p.url });
    }
  });
  doc.save(`${slug(r.title)}.pdf`);
}
