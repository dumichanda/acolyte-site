// Render the printable report page to PDF with headless Chromium.
//   node scripts/make-report.mjs [url] [out.pdf]
// Default: the local preview server (npm run preview) -> reports/acolyte-index-<date>.pdf
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173/?report";
const date = new Date().toISOString().slice(0, 10);
const out = process.argv[3] ?? `../reports/acolyte-index-${date}.pdf`;

mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".report svg");
await page.waitForTimeout(500);
await page.pdf({ path: out, format: "A4", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
await browser.close();
console.log(`Report saved: ${out}`);
