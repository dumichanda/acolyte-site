import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../landing/landing.css";
import "./property.css";
import { url } from "../site";

interface PropertySummary {
  day: string; for_sale: number; to_rent: number; regions: number; listings_tracked: number; bond_rate: string | number | null;
  days_of_data: number; top_regions: { region: string; listings: number }[];
  provinces: { province: string; for_sale: number; to_rent: number }[];
}

const n = (v: number) => Math.round(v).toLocaleString("en-ZA");
const ASK = url("/analyst/?industry=property");

const MORNING = [
  { t: "Daily Property Brief", x: "Written by your analyst from that morning's data: where stock is building, how prices and rents compare, where sellers are cutting, who holds the listings. Ready as a 5-slide PowerPoint before your sales meeting." },
  { t: "Live dashboards", x: "A ready-made property board from day one: stock by province and region, asking prices, rents, gross yields, agency share and price cuts. Pin any chart from a chat to add it." },
  { t: "Ask anything", x: "\"Where are 2-bed yields highest?\" \"Who is listing the most in Durban?\" Your analyst writes the query, draws the chart and shows its working." },
  { t: "Board-ready packs", x: "Ask for a report on any market and get a branded executive brief or full PowerPoint pack with editable charts, for your principals, developers or clients." },
];

const QUESTIONS = [
  "Where is residential stock for sale building fastest?",
  "Median rent vs asking price by region: where are gross yields highest?",
  "Which agencies hold the most listings in Johannesburg, Cape Town and Durban?",
  "Where are sellers cutting asking prices, and by how much?",
  "How do 3-bedroom house prices compare across Gauteng's regions?",
  "Where should we focus listing efforts next quarter?",
];

const WHO = [
  { t: "Estate agencies", x: ["Spot regions where stock and price cuts are building", "See your share of listings next to competitors", "Walk into valuations with pricing evidence", "Send clients a monthly market update"] },
  { t: "Developers", x: ["Compare asking prices and rents by area and type", "Gauge supply before you commit to a site", "Track how fast competing stock moves"] },
  { t: "Banks & investors", x: ["Indicative gross yields by region and bedrooms", "Stock and pricing trends next to the bond rate", "Jobs and housing side by side, by metro"] },
];

function BriefPreview({ p }: { p: PropertySummary | null }) {
  const max = Math.max(1, ...(p?.top_regions ?? []).map((r) => r.listings));
  return (
    <div className="console pp-brief reveal d2 in" aria-label="Live market numbers">
      <div className="top mono">
        <span className="dots"><i /><i /><i /></span>
        <span>daily property brief · {p ? new Date(p.day).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "loading"}</span>
        <span className="live"><i />LIVE</span>
      </div>
      <div className="body">
        {p ? <>
          <div className="pp-kpis">
            <div><b>{n(p.for_sale)}</b><span>homes for sale</span></div>
            <div><b>{n(p.to_rent)}</b><span>homes to rent</span></div>
            {p.bond_rate != null && <div><b>{Number(p.bond_rate).toFixed(2).replace(/\.?0+$/, "")}%</b><span>bond rate</span></div>}
          </div>
          <div className="who mono">biggest sales markets</div>
          <div className="abars">
            {p.top_regions.slice(0, 6).map((r) => (
              <div className="r" key={r.region}>
                <span>{r.region}</span><span className="v">{n(r.listings)}</span>
                <div className="t"><div className="f" style={{ width: `${(100 * r.listings) / max}%` }} /></div>
              </div>
            ))}
          </div>
        </> : <p className="muted">Live numbers appear here after the first morning refresh.</p>}
      </div>
      <div className="src mono">Residential listings from third-party data providers across {p?.regions ?? 48} regions · full counts, refreshed daily</div>
    </div>
  );
}

function App() {
  const [p, setP] = useState<PropertySummary | null>(null);
  useEffect(() => {
    fetch(url("/data/snapshot.json")).then((r) => (r.ok ? r.json() : null)).then((s) => setP(s?.property ?? null)).catch(() => setP(null));
  }, []);
  const maxProv = Math.max(1, ...(p?.provinces ?? []).map((x) => x.for_sale + x.to_rent));

  return (
    <div className="lp pp">
      <nav className="bar">
        <div className="inner">
          <a className="logo" href={url("/")}><img src={url("/favicon.svg")} alt="" />acolyte <span className="pp-tag">property</span></a>
          <div className="pill links">
            <a href="#morning">What you get</a>
            <a href="#market">Live market</a>
            <a href={ASK}>Ask the analyst</a>
            <a className="btn-signal" href={url("/#contact")}>Book a demo</a>
          </div>
        </div>
      </nav>

      <section className="hero pp-hero">
        <div className="glow" />
        <div className="inner">
          <div>
            <span className="eyebrow reveal in">Acolyte for Property</span>
            <h1 className="reveal d1 in">Your own AI<br /><em>property analyst.</em></h1>
            <p className="lede reveal d2 in">
              For South African estate agencies, developers and investors. It works on your listings, valuations and sales, writes your
              brief, keeps your dashboards live, and answers any question in plain English. See it here on the market across all 9 provinces.
            </p>
            <div className="actions reveal d3 in">
              <a className="btn-signal" href={url("/#contact")}>Book a demo <span className="arr">→</span></a>
              <a className="btn-line" href={ASK}>Ask it a question now</a>
            </div>
            <div className="meta mono reveal d3 in">
              <span><b>5</b> expert skills</span><span><b>07:00</b> brief</span><span><b>Your</b> data, read-only</span>
            </div>
          </div>
          <BriefPreview p={p} />
        </div>
      </section>

      <section id="morning">
        <div className="inner">
          <span className="eyebrow">What you get</span>
          <h2>Before your <em>morning sales meeting.</em></h2>
          <p className="lede">One analyst, working only on property, on your agency's own data. Shown below on public South African listings.</p>
          <div className="pp-cards">
            {MORNING.map((m, k) => (
              <article key={m.t} className="pp-card"><span className="mono">0{k + 1}</span><h3>{m.t}</h3><p>{m.x}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="proof" id="market">
        <div className="inner">
          <div className="row">
            <div>
              <span className="eyebrow">Demonstration: the live market</span>
              <h2>Watch it work <em>on the market.</em></h2>
              <p className="lede">To show the analyst at work: listing counts for every province and region and price trends from a daily sample, summarised. For your agency it reads your own listings and sales.</p>
            </div>
            <a className="btn-signal" href={ASK}>Ask about your area <span className="arr">→</span></a>
          </div>
          {p ? (
            <div className="pp-prov">
              <div className="pp-legend mono"><span><i className="s" />for sale</span><span><i className="r" />to rent</span></div>
              {p.provinces.map((x) => (
                <div key={x.province} className="pp-row">
                  <span className="name">{x.province}</span>
                  <div className="bar"><i className="s" style={{ width: `${(100 * x.for_sale) / maxProv}%` }} /><i className="r" style={{ width: `${(100 * x.to_rent) / maxProv}%` }} /></div>
                  <span className="v mono">{n(x.for_sale)} · {n(x.to_rent)}</span>
                </div>
              ))}
              <div className="note">Residential listings from third-party data providers, {new Date(p.day).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.
                {p.days_of_data < 7 ? " Trends build up as each day is added." : ` ${p.days_of_data} days of history.`}</div>
            </div>
          ) : <p className="note">Live numbers appear here after the first morning refresh.</p>}
        </div>
      </section>

      <section>
        <div className="inner">
          <span className="eyebrow">Ask it</span>
          <h2>Questions agencies <em>actually ask.</em></h2>
          <div className="pp-qs">
            {QUESTIONS.map((q) => <a key={q} className="pp-q" href={ASK}>{q}<span className="arr">→</span></a>)}
          </div>
        </div>
      </section>

      <section>
        <div className="inner">
          <span className="eyebrow">Who it's for</span>
          <h2>Built for the people who <em>price property.</em></h2>
          <div className="pp-who">
            {WHO.map((w) => <div key={w.t}><h3>{w.t}</h3><ul>{w.x.map((x) => <li key={x}>{x}</li>)}</ul></div>)}
          </div>
        </div>
      </section>

      <section className="pp-data">
        <div className="inner">
          <span className="eyebrow">About the data</span>
          <div className="pp-facts">
            <div><b>Source</b><p>Public listings from third-party data providers, collected every morning and shown only as counts, medians and trends, to demonstrate the analyst. Acolyte does not sell or supply listing data; your analyst works on data you own or license.</p></div>
            <div><b>What it measures</b><p>Asking prices and rents, not transfer prices. Yields are indicative gross yields from asking prices.</p></div>
            <div><b>POPIA</b><p>No agent or seller personal details are stored, only agency and branch names. Your questions and dashboards stay in your account.</p></div>
          </div>
        </div>
      </section>

      <section id="contact-cta">
        <div className="inner pp-cta">
          <h2>See it on <em>your</em> market.</h2>
          <p className="lede">Book a 30-minute demo. Bring your regions and we'll run the brief for them live.</p>
          <div className="actions">
            <a className="btn-signal" href={url("/#contact")}>Book a demo <span className="arr">→</span></a>
            <a className="btn-line" href={ASK}>Try the analyst</a>
          </div>
        </div>
      </section>

      <footer className="site">
        <div className="inner" style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <span>Acolyte for Property · part of the <a href={url("/")}>Acolyte</a> AI analytics platform</span>
          <span><a href={url("/#use-cases")}>Other use cases</a> · <a href={url("/privacy/")}>Privacy</a></span>
        </div>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
