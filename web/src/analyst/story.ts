/**
 * Story style: an image-led, plain-language version of a report pack, made for everyday readers and
 * the basis of social posts and explainer videos ("What's going on with Gauteng property prices? Good or bad?").
 *
 * Slides: hero cover · the short answer · per finding: a picture slide (verdict + one big number) then its charts,
 * the same charts as the report on the site · good news vs watch-outs · what to do now · close.
 * Pictures come from the Acolyte image library (web/public/assets/library/index.json), matched by tags.
 * When no picture fits, the slide draws its own simple illustration from shapes, so a deck never has a hole.
 */
import { brand, C, chartBlock, dataSource, H, M, W, type Prim, type SlideSpec } from "./deck";
import type { ChartArtifact, Kpi, ReportArtifact, Section } from "./chart";
import { url } from "../site";

export interface StoryImage { file: string; tags: string[]; data: string; aspect: number }
interface LibraryEntry { file: string; tags: string[] }

const clean = (s?: string) => (s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
const MINT = "F2F6E6";

/** Which analyst a report belongs to, from its charts' SQL. */
export function storyIndustry(r: ReportArtifact): string {
  const sql = Object.values(r.charts || {}).map((c) => c.sql || "").join(" ");
  if (/amazon|takealot|marketplace/i.test(sql)) return "marketplace";
  if (/retail_/.test(sql)) return "retail";
  if (/property_|bond_rate|areas/.test(sql)) return "property";
  if (/salary|employer|jobs/.test(sql)) return "talent";
  return "general";
}

/** Words in the text that map to library tags. */
const CUES: [RegExp, string[]][] = [
  [/gauteng|joburg|johannesburg|sandton|midrand/i, ["gauteng", "johannesburg"]],
  [/pretoria|tshwane|centurion/i, ["pretoria", "gauteng"]],
  [/cape town|western cape|stellenbosch/i, ["cape-town", "western-cape"]],
  [/durban|kwazulu|kzn|umhlanga/i, ["durban", "kzn"]],
  [/gauteng.*cape|cape.*gauteng|versus|\bvs\b|compared/i, ["comparison", "gauteng-vs-cape"]],
  [/price cut|reduc|cheaper|fell|drop|down\b|lower/i, ["prices-down", "price-cuts"]],
  [/rose|rising|up\b|higher|increase|climb/i, ["prices-up", "trend"]],
  [/rent|yield/i, ["rent", "yield"]],
  [/bond|interest|repo|prime/i, ["bond-rate", "interest"]],
  [/new listing|stock|supply|develop/i, ["supply", "listings"]],
  [/townhouse|estate|sectional/i, ["townhouse", "estate"]],
  [/house brand|private label|no.?name/i, ["house-brand", "name-brand"]],
  [/special|promo|discount|deal/i, ["specials", "promotions"]],
  [/basket|staple|maize|bread|milk|oil/i, ["basket", "staples"]],
  [/inflation|cpi|cost of living/i, ["inflation", "cpi"]],
  [/shrink|pack size|smaller/i, ["shrinkflation"]],
  [/black friday/i, ["black-friday"]],
  [/review|rating|star/i, ["reviews", "ratings"]],
  [/seller|merchant|sme/i, ["seller", "sme"]],
  [/deliver|courier|parcel/i, ["delivery", "parcel"]],
  [/salar|pay\b|wage|earn/i, ["salaries", "pay"]],
  [/graduate|learnership|entry.?level|junior/i, ["graduates", "youth"]],
  [/remote|hybrid/i, ["remote", "hybrid"]],
  [/\bai\b|automat/i, ["automation", "ai"]],
  [/hiring|vacanc|job ads?|demand/i, ["hiring", "jobs"]],
  [/search|google trends|interest over time/i, ["search", "trends"]],
  [/province|national|south africa/i, ["map", "provinces"]],
];
const cueTags = (text: string) => CUES.flatMap(([re, tags]) => (re.test(text) ? tags : []));

/** Load the image library as data URLs (both renderers need inline images). Missing library = no pictures. */
export async function loadStoryImages(): Promise<StoryImage[]> {
  try {
    const res = await fetch(url("/assets/library/index.json"), { cache: "no-cache" });
    if (!res.ok) return [];
    const list = ((await res.json()).images || []) as LibraryEntry[];
    const out = await Promise.all(list.map(async (e) => {
      try {
        const r = await fetch(url("/assets/library/" + e.file));
        if (!r.ok) return null;
        const blob = await r.blob();
        const data = await new Promise<string>((ok, bad) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = bad; f.readAsDataURL(blob); });
        const aspect = await new Promise<number>((ok) => { const im = new Image(); im.onload = () => ok(im.naturalWidth / im.naturalHeight || 16 / 9); im.onerror = () => ok(16 / 9); im.src = data; });
        return { file: e.file, tags: e.tags || [], data, aspect } as StoryImage;
      } catch { return null; }
    }));
    return out.filter((x): x is StoryImage => !!x);
  } catch { return []; }
}

/** Picks the best-matching unused picture for a piece of text. */
function picker(images: StoryImage[], industry: string) {
  const used = new Set<string>();
  const ind = industry === "talent" ? "talent" : industry;
  return (text: string, prefer: string[] = []): StoryImage | null => {
    const want = new Set([...prefer, ...cueTags(text)]);
    let best: StoryImage | null = null, score = -1;
    for (const im of images) {
      if (used.has(im.file)) continue;
      const s = (im.tags.includes(ind) ? 3 : im.tags.includes("general") ? 1 : -5) + im.tags.filter((t) => want.has(t)).length * 2;
      if (s > score) { best = im; score = s; }
    }
    if (best && score > 0) { used.add(best.file); return best; }
    return null;
  };
}

type Verdict = { label: string; fill: string; text: string };
function verdictOf(s: Section): Verdict {
  const tone = s.kpis?.[0]?.tone || "";
  const t = `${s.title || ""} ${s.takeaway || ""}`.toLowerCase();
  if (tone === "negative" || /risk|warn|pressure|squeez|slow|weak|fell short|concern/.test(t)) return { label: "WATCH OUT", fill: "FF6A3D", text: "FFFFFF" };
  if (tone === "positive" || /opportun|strong|grew|gain|good|cheaper|saving/.test(t)) return { label: "GOOD NEWS", fill: C.lime, text: C.ink };
  return { label: "WORTH KNOWING", fill: "FFFFFF", text: C.ink };
}

/** One big number for a finding: its first KPI, else the first number in its takeaway. */
function bigNumber(s: Section): { value: string; label: string } | null {
  const k: Kpi | undefined = s.kpis?.[0];
  if (k?.value) return { value: clean(k.value), label: clean(k.label) + (k.context ? ` · ${clean(k.context)}` : "") };
  const m = clean(s.takeaway).match(/(R\s?[\d,.]+\s?(?:m|bn|k)?|[-+]?\d[\d,.]*\s?%|\d[\d,.]+)/i);
  return m ? { value: m[1].replace(/\s/g, ""), label: "" } : null;
}

/** A simple drawn illustration when no picture fits: stacked tiles rising like a chart, in brand colours. */
function illustration(p: Prim[], x: number, y: number, w: number, h: number, up = true) {
  p.push({ t: "rect", x, y, w, h, fill: C.darkCard });
  const n = 5, gap = w * 0.04, bw = (w * 0.7 - gap * (n - 1)) / n, base = y + h * 0.82;
  for (let i = 0; i < n; i++) {
    const f = up ? 0.25 + i * 0.13 : 0.77 - i * 0.12, bh = h * 0.62 * f;
    p.push({ t: "rect", x: x + w * 0.15 + i * (bw + gap), y: base - bh, w: bw, h: bh, fill: i === (up ? n - 1 : 0) ? C.lime : shadeInk(i), radius: 0.08 });
  }
  p.push({ t: "rect", x: x + w * 0.12, y: base + 0.04, w: w * 0.76, h: 0.03, fill: "3A3B42" });
  p.push({ t: "rect", x: x + w * 0.72, y: y + h * 0.12, w: w * 0.14, h: w * 0.14, fill: C.lime, radius: w * 0.07, alpha: 0.85 });
}
const shadeInk = (i: number) => ["2E3036", "34363D", "3A3C44", "40434B", "474A53"][i % 5];

function picture(p: Prim[], im: StoryImage | null, x: number, y: number, w: number, h: number, fallbackUp = true) {
  if (im) p.push({ t: "image", x, y, w, h, data: im.data, aspect: im.aspect });
  else illustration(p, x, y, w, h, fallbackUp);
}

function chip(p: Prim[], v: Verdict, x: number, y: number) {
  const w = 0.5 + v.label.length * 0.13;
  p.push({ t: "rect", x, y, w, h: 0.42, fill: v.fill, radius: 0.21 });
  p.push({ t: "text", x, y, w, h: 0.42, text: v.label, size: 11, bold: true, color: v.text, align: "center", valign: "middle", spacing: 1.5 });
}

function mark(p: Prim[], x: number, y: number, dark = true) {
  const b = brand();
  if (b?.logo) { p.push({ t: "logo", x, y, s: 0.36, w: Math.min(0.36 * (b.logoAspect || 1), 2.2) }); return; }
  if (!b) p.push({ t: "logo", x, y, s: 0.28 });
  p.push({ t: "text", x: b ? x : x + 0.36, y: y - 0.02, w: 3, h: 0.32, text: (b?.name || "Acolyte").toUpperCase(), size: 10, bold: true, color: dark ? "FFFFFF" : C.ink, valign: "middle", spacing: 3 });
}

const footer = (p: Prim[], text: string, page: number, dark: boolean) => {
  p.push({ t: "text", x: M, y: H - 0.42, w: W - 2 * M - 0.6, h: 0.26, text, size: 7.5, color: dark ? "A9A8B0" : "6B6656", valign: "middle" });
  p.push({ t: "text", x: W - M - 0.5, y: H - 0.42, w: 0.5, h: 0.26, text: String(page), size: 8, color: dark ? "A9A8B0" : "6B6656", align: "right", valign: "middle" });
};

export function buildStory(r: ReportArtifact, images: StoryImage[]): SlideSpec[] {
  const slides: SlideSpec[] = [];
  const industry = storyIndustry(r);
  const pick = picker(images, industry);
  const src = dataSource(r);
  const month = new Date(r.generated || Date.now()).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const foot = `${brand() ? `Prepared for ${brand()!.name} · ` : "Acolyte · "}${src.data} · ${month}`;
  const sections = r.sections.filter((s) => s.title || s.takeaway);   // every finding, as on the site
  const exec = r.exec;
  const LIGHT_INK = C.ink;

  // 1. Hero cover: full-bleed picture, dark wash on the left, big question-style headline.
  {
    const p: Prim[] = [];
    const hero = pick(`${r.title} ${r.scope || ""} ${exec?.takeaway || ""}`, ["city", "comparison"]);
    if (hero) p.push({ t: "image", x: 0, y: 0, w: W, h: H, data: hero.data, aspect: hero.aspect });
    else illustration(p, W * 0.45, 0, W * 0.55, H, true);
    p.push({ t: "rect", x: 0, y: 0, w: W * 0.62, h: H, fill: C.ink, alpha: hero ? 0.84 : 1 });
    p.push({ t: "rect", x: W * 0.62, y: 0, w: W * 0.38, h: H, fill: C.ink, alpha: hero ? 0.25 : 0 });
    mark(p, 0.7, 0.6);
    p.push({ t: "rect", x: 0.7, y: 1.55, w: 2.6, h: 0.4, fill: C.lime, radius: 0.2 });
    p.push({ t: "text", x: 0.7, y: 1.55, w: 2.6, h: 0.4, text: `THE STORY · ${month.toUpperCase()}`, size: 9, bold: true, color: C.ink, align: "center", valign: "middle", spacing: 1 });
    p.push({ t: "text", x: 0.7, y: 2.2, w: 7.2, h: 2.6, text: clean(r.title), size: 40, min: 24, bold: true, color: "FFFFFF", valign: "top" });
    if (r.scope) p.push({ t: "text", x: 0.7, y: 4.95, w: 7.0, h: 0.7, text: clean(r.scope), size: 14, min: 10, color: C.lime, bold: true });
    p.push({ t: "text", x: 0.7, y: 6.55, w: 7.2, h: 0.4, text: `In plain language · ${src.caveat}`, size: 9, color: "C9C8C2" });
    slides.push({ bg: C.ink, prims: p });
  }

  // 2. The short answer.
  if (exec?.takeaway) {
    const p: Prim[] = [];
    mark(p, M, 0.4);
    p.push({ t: "text", x: M, y: 1.0, w: 6, h: 0.4, text: "THE SHORT ANSWER", size: 12, bold: true, color: C.lime, spacing: 2 });
    p.push({ t: "text", x: M, y: 1.5, w: W - 2 * M, h: 2.3, text: clean(exec.takeaway), size: 30, min: 18, bold: true, color: "FFFFFF", valign: "top" });
    const ks = (exec.kpis || []).slice(0, 3);
    const cw = (W - 2 * M - 0.4 * (ks.length - 1)) / Math.max(ks.length, 1);
    ks.forEach((k, i) => {
      const x = M + i * (cw + 0.4);
      p.push({ t: "rect", x, y: 4.05, w: cw, h: 1.75, fill: C.darkCard, radius: 0.18, shadow: true });
      p.push({ t: "text", x: x + 0.25, y: 4.2, w: cw - 0.5, h: 0.85, text: clean(k.value), size: 40, min: 20, bold: true, valign: "middle",
        color: k.tone === "negative" ? "FF8A70" : k.tone === "positive" ? "7FD8A2" : C.lime });
      p.push({ t: "text", x: x + 0.25, y: 5.08, w: cw - 0.5, h: 0.62, text: clean(k.label) + (k.context ? ` · ${clean(k.context)}` : ""), size: 11, min: 8, color: "C9C8C2" });
    });
    if (exec.so_what) {
      p.push({ t: "rect", x: M, y: 6.05, w: W - 2 * M, h: 0.8, fill: C.lime, radius: 0.16 });
      p.push({ t: "text", x: M + 0.3, y: 6.05, w: W - 2 * M - 0.6, h: 0.8, text: `Why it matters: ${clean(exec.so_what)}`, size: 13, min: 9, bold: true, color: C.ink, valign: "middle" });
    }
    slides.push({ bg: C.ink, prims: p });
  }

  const shown = new Set<ChartArtifact>();
  // 3. One slide per finding: picture on one side, verdict + big number + plain words on the other.
  sections.forEach((s, i) => {
    const p: Prim[] = [];
    const dark = i % 2 === 1, ink = dark ? "FFFFFF" : LIGHT_INK, sub = dark ? "C9C8C2" : "3D3D45";
    const left = i % 2 === 0, pw = W * 0.46, px = left ? 0 : W - pw, tx = left ? pw + 0.55 : M, tw = W - pw - 0.55 - M;
    const v = verdictOf(s);
    const im = pick(`${s.title || ""} ${s.takeaway || ""} ${s.question || ""}`);
    picture(p, im, px, 0, pw, H, v.label !== "WATCH OUT");
    chip(p, v, px + 0.4, 0.45);
    p.push({ t: "text", x: tx, y: 0.5, w: tw, h: 0.3, text: `${i + 1} of ${sections.length}${s.question ? ` · ${clean(s.question)}` : ""}`, size: 10, min: 8, color: dark ? C.lime : C.olive, bold: true });
    p.push({ t: "text", x: tx, y: 0.95, w: tw, h: 1.5, text: clean(s.title || s.heading), size: 28, min: 17, bold: true, color: ink, valign: "top" });
    const big = bigNumber(s);
    const ex = (s.explainers || [])[0], tight = !!ex?.term;
    let y = 2.6;
    if (big) {
      p.push({ t: "text", x: tx, y, w: tw, h: 1.25, text: big.value, size: 66, min: 30, bold: true, color: dark ? C.lime : C.olive, valign: "middle" });
      if (big.label) p.push({ t: "text", x: tx, y: y + 1.25, w: tw, h: 0.4, text: big.label, size: 11, min: 8, color: sub });
      y += tight ? 1.6 : 1.85;
    }
    if (s.takeaway) { const th = tight ? 0.8 : 1.1; p.push({ t: "text", x: tx, y, w: tw, h: th, text: clean(s.takeaway), size: 15, min: 10, color: ink, valign: "top" }); y += th + 0.1; }
    if (ex?.term && y < 5.9) {   // the jargon buster, documentary-style
      p.push({ t: "rect", x: tx, y: y + 0.05, w: 0.06, h: 0.75, fill: dark ? C.lime : C.olive });
      p.push({ t: "text", x: tx + 0.2, y, w: tw - 0.2, h: 0.85, text: `${clean(ex.term)}: ${clean(ex.means)} ${clean(ex.why)}`, size: 11.5, min: 8, color: sub, valign: "middle" });
      y += 1.0;
    }
    if (s.so_what && y < 6.2) {
      p.push({ t: "rect", x: tx, y, w: tw, h: H - 0.6 - y, fill: dark ? C.darkCard : "FFFFFF", radius: 0.16, shadow: true });
      p.push({ t: "text", x: tx + 0.22, y: y + 0.14, w: tw - 0.44, h: 0.3, text: "WHAT IT MEANS FOR YOU", size: 9, bold: true, color: dark ? C.lime : C.olive, spacing: 1 });
      p.push({ t: "text", x: tx + 0.22, y: y + 0.45, w: tw - 0.44, h: H - 0.6 - y - 0.55, text: clean(s.so_what), size: 12, min: 8, color: ink });
    }
    slides.push({ bg: dark ? C.ink : MINT, prims: p });

    // 3b. The evidence: this finding's charts, the same ones the report shows on the site (two per slide).
    const own = (s.chart_ids || []).map((id) => r.charts?.[id]).filter((c): c is ChartArtifact => !!c && c.type !== "kpi");
    own.forEach((c) => shown.add(c));
    for (let k = 0; k < own.length; k += 2) {
      const pair = own.slice(k, k + 2), q: Prim[] = [];
      q.push({ t: "text", x: M, y: 0.4, w: W - 2 * M, h: 0.35, text: `THE EVIDENCE · ${i + 1} of ${sections.length}`, size: 11, bold: true, color: C.olive, spacing: 2 });
      q.push({ t: "text", x: M, y: 0.8, w: W - 2 * M, h: 0.75, text: clean(s.title || s.heading), size: 22, min: 14, bold: true, color: LIGHT_INK, valign: "top" });
      const gap = 0.3, cw = (W - 2 * M - gap * (pair.length - 1)) / pair.length;
      pair.forEach((c, j) => chartBlock(q, c, M + j * (cw + gap), 1.7, cw, H - 1.7 - 0.6));
      footer(q, foot, slides.length + 1, false);
      slides.push({ bg: MINT, prims: q });
    }
  });

  // 4. The one chart that explains it: only when no finding carried a chart of its own.
  const charts = Object.values(r.charts || {}) as ChartArtifact[];
  const hero = shown.size ? undefined : charts.find((c) => c.annotations?.length && c.type !== "table" && c.type !== "kpi")
    || charts.find((c) => ["line", "area", "bar", "hbar"].includes(c.type));
  if (hero) {
    const p: Prim[] = [];
    p.push({ t: "text", x: M, y: 0.45, w: 8, h: 0.4, text: "THE ONE CHART THAT EXPLAINS IT", size: 12, bold: true, color: C.lime, spacing: 2 });
    p.push({ t: "text", x: M, y: 0.9, w: W - 2 * M, h: 0.8, text: clean(hero.title), size: 26, min: 16, bold: true, color: "FFFFFF" });
    if (hero.subtitle) p.push({ t: "text", x: M, y: 1.7, w: W - 2 * M, h: 0.4, text: clean(hero.subtitle), size: 12, min: 9, color: "C9C8C2" });
    p.push({ t: "rect", x: M, y: 2.25, w: W - 2 * M, h: 4.55, fill: "1C1D22", radius: 0.2, shadow: true });
    p.push({ t: "chart", x: M + 0.2, y: 2.4, w: W - 2 * M - 0.4, h: 4.25, chart: hero });
    footer(p, foot, slides.length + 1, true);
    slides.push({ bg: "141417", prims: p });
  }

  // 5. Good thing or bad thing?
  {
    const goods = sections.filter((s) => verdictOf(s).label === "GOOD NEWS").map((s) => clean(s.title || s.takeaway));
    const bads = [...sections.filter((s) => verdictOf(s).label === "WATCH OUT").map((s) => clean(s.title || s.takeaway)), ...(r.conclusions?.risks || []).map(clean)];
    const meh = sections.filter((s) => verdictOf(s).label === "WORTH KNOWING").map((s) => clean(s.title || s.takeaway));
    if (goods.length + bads.length) {
      const p: Prim[] = [];
      p.push({ t: "text", x: M, y: 0.45, w: W - 2 * M, h: 0.7, text: "So, is it a good thing or a bad thing?", size: 30, min: 20, bold: true, color: LIGHT_INK });
      if (exec?.catch) p.push({ t: "text", x: M, y: 1.2, w: W - 2 * M, h: 0.6, text: clean(exec.catch), size: 13, min: 9, color: "3D3D45" });
      const cw = (W - 2 * M - 0.4) / 2;
      const col = (x: number, title: string, items: string[], fill: string, tc: string) => {
        p.push({ t: "rect", x, y: 2.0, w: cw, h: 4.75, fill, radius: 0.2, shadow: true });
        p.push({ t: "text", x: x + 0.35, y: 2.2, w: cw - 0.7, h: 0.5, text: title, size: 18, bold: true, color: tc });
        p.push({ t: "list", x: x + 0.35, y: 2.85, w: cw - 0.7, h: 3.7, items: items.slice(0, 5), size: 14, min: 9, color: tc });
      };
      col(M, "The good news", goods.length ? [...goods, ...meh].slice(0, 5) : meh.slice(0, 5), C.lime, C.ink);
      col(M + cw + 0.4, "The watch-outs", bads.length ? bads : ["Nothing alarming this month — keep watching the trend."], C.ink, "FFFFFF");
      footer(p, foot, slides.length + 1, false);
      slides.push({ bg: MINT, prims: p });
    }
  }

  // 5b. What others are saying: outside sources from the analyst's web research (verified server-side).
  const quotes = (r.sources || []).filter((x) => x.quote).slice(0, 3);
  if (quotes.length) {
    const p: Prim[] = [];
    p.push({ t: "text", x: M, y: 0.45, w: 9, h: 0.4, text: "WHAT OTHERS ARE SAYING", size: 12, bold: true, color: C.lime, spacing: 2 });
    p.push({ t: "text", x: M, y: 0.9, w: W - 2 * M, h: 0.8, text: "It is not just our numbers", size: 30, min: 20, bold: true, color: "FFFFFF" });
    const cw = (W - 2 * M - 0.35 * (quotes.length - 1)) / quotes.length;
    quotes.forEach((q, i) => {
      const x = M + i * (cw + 0.35);
      p.push({ t: "rect", x, y: 1.95, w: cw, h: 4.75, fill: C.darkCard, radius: 0.2, shadow: true });
      p.push({ t: "rect", x: x + 0.3, y: 2.35, w: 0.9, h: 0.09, fill: C.lime });
      p.push({ t: "text", x: x + 0.3, y: 2.85, w: cw - 0.6, h: 2.0, text: clean(q.quote), size: 17, min: 10, bold: true, color: "FFFFFF", valign: "top" });
      p.push({ t: "text", x: x + 0.3, y: 4.95, w: cw - 0.6, h: 0.35, text: `${clean(q.publisher || q.title)}${q.date ? ", " + clean(q.date) : ""}`, size: 10, bold: true, color: C.lime });
      if (q.point) p.push({ t: "text", x: x + 0.3, y: 5.35, w: cw - 0.6, h: 1.1, text: clean(q.point), size: 10.5, min: 8, color: "C9C8C2" });
      p.push({ t: "link", x, y: 1.95, w: cw, h: 4.75, url: q.url });
    });
    footer(p, foot, slides.length + 1, true);
    slides.push({ bg: C.ink, prims: p });
  }

  // 6. What to do now.
  const actions = (r.conclusions?.actions || []).map(clean).slice(0, 3);
  if (actions.length) {
    const p: Prim[] = [];
    const im = pick(actions.join(" "), ["general", "analytics"]);
    picture(p, im, W - 4.3, 0, 4.3, H, true);
    p.push({ t: "text", x: M, y: 0.5, w: 8, h: 0.8, text: "What to do now", size: 34, min: 22, bold: true, color: "FFFFFF" });
    const th = (H - 2.0 - 0.25 * (actions.length - 1)) / actions.length;
    actions.forEach((a, i) => {
      const y = 1.55 + i * (th + 0.25);
      p.push({ t: "rect", x: M, y, w: W - 4.3 - M - 0.45, h: th, fill: C.darkCard, radius: 0.18, shadow: true });
      p.push({ t: "rect", x: M + 0.25, y: y + th / 2 - 0.35, w: 0.7, h: 0.7, fill: C.lime, radius: 0.35 });
      p.push({ t: "text", x: M + 0.25, y: y + th / 2 - 0.35, w: 0.7, h: 0.7, text: String(i + 1), size: 22, bold: true, color: C.ink, align: "center", valign: "middle" });
      p.push({ t: "text", x: M + 1.2, y: y + 0.15, w: W - 4.3 - M - 0.45 - 1.45, h: th - 0.3, text: a, size: 15, min: 9, color: "FFFFFF", valign: "middle" });
    });
    slides.push({ bg: C.ink, prims: p });
  }

  // 7. Close.
  {
    const p: Prim[] = [];
    const im = pick("analyst dashboard search", ["analytics", "dashboard", "general"]);
    if (im) { p.push({ t: "image", x: 0, y: 0, w: W, h: H, data: im.data, aspect: im.aspect }); p.push({ t: "rect", x: 0, y: 0, w: W, h: H, fill: C.ink, alpha: 0.78 }); }
    mark(p, W / 2 - 1.2, 1.4);
    p.push({ t: "text", x: 1, y: 2.3, w: W - 2, h: 1.4, text: "Got a follow-up question?", size: 40, min: 24, bold: true, color: "FFFFFF", align: "center", valign: "middle" });
    p.push({ t: "text", x: 1.5, y: 3.7, w: W - 3, h: 0.9, text: "Ask your own AI analyst. It reads the same live South African data behind this story, and your own numbers next to it.", size: 16, min: 11, color: "C9C8C2", align: "center" });
    p.push({ t: "rect", x: W / 2 - 1.9, y: 4.9, w: 3.8, h: 0.6, fill: C.lime, radius: 0.3 });
    p.push({ t: "text", x: W / 2 - 1.9, y: 4.9, w: 3.8, h: 0.6, text: "Ask the analyst →", size: 14, bold: true, color: C.ink, align: "center", valign: "middle" });
    p.push({ t: "text", x: 1, y: 6.7, w: W - 2, h: 0.4, text: `Source: ${src.data}. ${src.caveat[0].toUpperCase()}${src.caveat.slice(1)}. Pictures are illustrations.${quotes.length ? " Quotes link to their original sources." : ""}`, size: 8.5, color: "A9A8B0", align: "center" });
    slides.push({ bg: C.ink, prims: p });
  }
  return slides;
}
