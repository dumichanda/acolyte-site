// After the build: a plain HTML page per published report (so search engines can read it) and sitemap.xml.
// Reports load in the browser on /reports/; these pages carry the same words as text, with a link to the interactive version.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SITE = "https://acolytegroup.co.za";
const dist = new URL("../dist/", import.meta.url).pathname;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clean = (s) => esc(String(s ?? "").replace(/\*\*(.+?)\*\*/g, "$1"));
const month = (p, mtd) => new Date(p + "T00:00:00").toLocaleDateString("en-ZA", { month: "long", year: "numeric" }) + (mtd ? " (month to date)" : "");

const idxFile = join(dist, "data/reports/index.json");
const reports = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, "utf8")).reports || [] : [];
const urls = ["/", "/analyst/", "/dashboards/", "/reports/", "/contact/", "/property/", "/automation-index/", "/employers/", "/tools/", "/privacy/"];

for (const card of reports) {
  const f = join(dist, `data/reports/${card.id}.json`);
  if (!existsSync(f)) continue;
  const { report: r, analyst } = JSON.parse(readFileSync(f, "utf8"));
  const ex = r.exec || {};
  const desc = (ex.takeaway || r.summary || "").slice(0, 300);
  const kpis = (ks) => (ks || []).length ? `<ul class="k">${ks.map((k) => `<li><b>${clean(k.value)}</b> ${clean(k.label)}${k.context ? ` <span>${clean(k.context)}</span>` : ""}</li>`).join("")}</ul>` : "";
  const sections = (r.sections || []).map((s) => `
    <section><h2>${clean(s.title || s.heading)}</h2>
      ${s.question ? `<p class="q">${clean(s.question)}</p>` : ""}${s.takeaway ? `<p>${clean(s.takeaway)}</p>` : ""}${kpis(s.kpis)}
      ${(s.bullets || []).length ? `<ul>${s.bullets.map((b) => `<li>${clean(b)}</li>`).join("")}</ul>` : ""}
      ${s.so_what ? `<p><b>So what:</b> ${clean(s.so_what)}</p>` : ""}
      ${(s.explainers || []).map((e) => `<p class="x"><b>${clean(e.term)}:</b> ${clean(e.means)} ${clean(e.why)}</p>`).join("")}</section>`).join("");
  const c = r.conclusions || {};
  const list = (h, xs) => (xs || []).length ? `<h3>${h}</h3><ul>${xs.map((x) => `<li>${clean(x)}</li>`).join("")}</ul>` : "";
  const path = `/reports/${card.id}/`;
  urls.push(path);
  mkdirSync(join(dist, `reports/${card.id}`), { recursive: true });
  writeFileSync(join(dist, `reports/${card.id}/index.html`), `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${clean(r.title)} | Acolyte</title>
<meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}${path}"><link rel="icon" href="/favicon.svg">
<meta property="og:title" content="${clean(r.title)}"><meta property="og:description" content="${esc(desc)}">
<style>body{margin:0;background:#0c0c0e;color:#ecebe6;font:16px/1.6 system-ui,sans-serif}main{max-width:820px;margin:0 auto;padding:32px 18px 80px}
a{color:#c8f135}h1{font-size:30px;line-height:1.2}h2{font-size:21px;margin-top:36px}.m,.q,span,.x{color:#a3a3a8}.k{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:10px}
.k li{border:1px solid #2a2a30;border-radius:10px;padding:8px 12px}.k b{color:#c8f135}.cta{display:inline-block;margin:10px 0;padding:10px 18px;border-radius:999px;background:#c8f135;color:#0c0c0e;text-decoration:none;font-weight:600}</style>
</head><body><main>
<p class="m"><a href="/">Acolyte</a> · <a href="/reports/">Reports</a> · ${esc(analyst)} · ${esc(month(card.period, card.month_to_date))}</p>
<h1>${clean(r.title)}</h1>
<p><a class="cta" href="/reports/#report-${card.id}">Open the interactive report, with charts and downloads →</a></p>
${ex.takeaway ? `<p><b>${clean(ex.takeaway)}</b></p>` : ""}${kpis(ex.kpis)}${ex.so_what ? `<p>${clean(ex.so_what)}</p>` : ""}
${sections}
${list("Findings", c.findings)}${list("Risks", c.risks)}${list("What to do", c.actions)}
<p class="m">Written by Acolyte's ${esc(analyst)} on public South African market data from third-party data providers, as a demonstration of what an AI analyst can do on a client's own data.
<a href="/contact/">Book a free data session</a>.</p>
</main></body></html>`);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>
`);
console.log(`seo: ${reports.length} report page(s), sitemap with ${urls.length} URLs`);
