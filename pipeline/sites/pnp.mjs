// Pick n Pay shelf prices from its public category pages (robots.txt allows /c/ pages; search pages are not used).
// Opens each category in a real browser, reads the product list the page loads, then the category's further pages,
// waiting CRAWL_DELAY seconds between requests as the site's robots.txt asks.
//   node pnp.mjs <out.jsonl>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // global install locally; npm i playwright in CI
import { writeFileSync } from 'node:fs';

// sub-categories (top-level pages are landing pages without a product grid); together they cover the basket
const CATS = process.env.PNP_CATS ? process.env.PNP_CATS.split(',') : [
  'rice-pasta-and-maize-487551153', 'sugar-flour-and-baking-487551153', 'oil-and-vinegar-487551153', 'canned-foods-and-packets-487551153',
  'beans-and-legumes-487551153', 'jam-honey-and-spreads-487551153', 'condiments-sauces-and-dressing-487551153',
  'spices-and-seasonings-487551153', 'cooking-sauces-and-meal-kits-487551153', 'breakfast-cereals-and-bars-487551153',
  'biscuits-and-crackers-487551153', 'long-life-milk-487551153', 'chips-and-dip-1664414929', 'chocolates-and-sweets-1664414929',
  'savoury-snacks-1664414929', 'bread-and-rolls127069496', 'fresh-milk-and-cream44805192', 'long-life-uht-milk44805192',
  'dairy-drinks44805192', 'eggs44805192', 'cheese44805192', 'yoghurt44805192', 'butter-and-margarine44805192',
  'frozen-chicken-556619069', 'frozen-vegetables-556619069', 'frozen-chips-potatoes-and-sides-556619069', 'frozen-meat-556619069',
  'fresh-poultry1604668580', 'soft-drinks767886124', 'juices767886124', 'water767886124', 'coffee1750990951', 'tea1750990951',
  'hot-chocolate-and-malt1750990951', 'baby-nappies-and-changing1526525998', 'baby-food-and-drink1526525998',
  'baby-formula1526525998', 'baby-toiletries1526525998', 'pain-relief-565706108', 'coughs-colds-and-flu-565706108',
  'first-aid-565706108', 'cleaning2036785845', 'laundry-and-clothing2036785845', 'kitchen2036785845', 'bathroom2036785845',
  'insecticides2036785845', 'bath-shower-and-soap1294684892', 'oral-care1294684892', "men's-toiletries1294684892",
  "women's-toiletries1294684892", 'body-care1294684892', 'hair-care-and-colourants1294684892', 'tissues-and-toilet-paper1294684892',
  'dogs1958916695', 'cats1958916695'];
const DELAY = 1000 * Number(process.env.CRAWL_DELAY || 10);
const MAX_PAGES = Number(process.env.PNP_MAX_PAGES || 15);
const out = process.argv[2] || 'pnp.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = s => (s == null ? null : Number(String(s).replace(/[^\d.]/g, '')) || null);

const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await (await b.newContext({ locale: 'en-ZA' })).newPage();
const seen = new Map();
let requests = 0;

async function open(cat, n) {
  // open a category page as a shopper would (the site's own pagination links use ?currentPage=n) and read the product grid
  await page.goto(`https://www.pnp.co.za/c/${encodeURI(cat)}${n ? `?currentPage=${n}` : ''}`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('.product-grid-item', { timeout: 20000 }).catch(() => {});
  requests++;
  return page.evaluate(() => ({
    items: [...document.querySelectorAll('.product-grid-item')].map(e => ({
      title: e.getAttribute('aria-label'),
      desc: e.getAttribute('aria-description') || '',
      href: e.querySelector('a[href*="/p/"]')?.getAttribute('href') || '',
      shown: e.querySelector('.price')?.textContent.trim() || '',
      promo: e.querySelector('.product-grid-item__promotion-container')?.innerText.replace(/\s+/g, ' ').trim() || '',
      sponsored: !!e.querySelector('.product-grid-item__info-container--sponsored-text')?.textContent.trim(),
    })),
    next: !!document.querySelector('a.next:not(.disabled)'),
  }));
}

function take(grid, cat) {
  let added = 0;
  for (const g of grid.items) {
    const code = (g.href.match(/\/p\/([^/?#]+)/) || [])[1];
    if (!code || !g.title || seen.has(code)) continue;
    const regular = Number((g.desc.match(/([\d.]+) rands/) || [])[1]) || money(g.shown);   // normal price, not a member price
    if (!regular) continue;
    seen.set(code, { retailer: 'Pick n Pay', code, title: g.title, price: regular, promo: g.promo || null,
      in_stock: !/out of stock|unavailable/i.test(g.desc), url: 'https://www.pnp.co.za' + g.href, category: cat });
    added++;
  }
  return added;
}

await page.goto('https://www.pnp.co.za/', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});   // first visit sets the store and cookies
requests++;
await sleep(DELAY);

for (const cat of CATS) {
  let n = 0, pages = 0;
  for (; n < MAX_PAGES; n++) {
    const grid = await open(cat, n);
    if (!grid.items.length) break;
    take(grid, cat);
    pages++;
    await sleep(DELAY);
    if (!grid.next) break;
  }
  console.log(`${cat}: read ${pages} pages; catalogue now ${seen.size}`);
  if (!pages) await sleep(DELAY);
}
await b.close();
writeFileSync(out, [...seen.values()].map(x => JSON.stringify(x)).join('\n') + '\n');
console.log(`Pick n Pay: ${seen.size} products from ${requests} requests -> ${out}`);
