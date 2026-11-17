import ContactForm from "../contact/ContactForm";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Snapshot } from "../types";
import { rands } from "../types";
import { SITE, url } from "../site";
import MatrixRain from "./MatrixRain";
import BigStat from "./BigStat";
import { ANALYSTS as REPORT_ANALYSTS, latestPerAnalyst, loadIndex, monthLabel, type ReportCard } from "../reports/data";

const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- hooks ---------------- */

function useSnapshot() {
  const [s, setS] = useState<Snapshot | null>(null);
  useEffect(() => {
    fetch(url("/data/snapshot.json")).then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  }, []);
  return s;
}

/** Adds .in to every .reveal element as it scrolls into view. */
function useReveal(dep: unknown) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".lp .reveal:not(.in)");
    if (reduced || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

const spotlight = (e: MouseEvent<HTMLElement>) => {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
};

/* ---------------- Ask-your-data console (answers computed from the live index) ---------------- */

interface QA { q: string; text: ReactNode; bars: { label: string; value: number; shown: string }[] }

function buildQAs(s: Snapshot): QA[] {
  const fams = s.by_family.filter((f) => f.family !== "Other");
  const byJobs = [...fams].sort((a, b) => b.jobs - a.jobs).slice(0, 4);
  const byScore = [...fams].sort((a, b) => b.avg_score - a.avg_score).slice(0, 4);
  const provs = s.by_province.filter((p) => p.province !== "Unknown").slice(0, 4);
  const share = Math.round((100 * (provs[0]?.jobs ?? 0)) / Math.max(1, s.kpis.jobs));
  const skills = (s.insights?.skills ?? []).slice(0, 4);
  const qas: QA[] = [
    {
      q: "Which roles are South African employers hiring for most?",
      text: <><b>{byJobs[0].family}</b> leads with <b>{byJobs[0].jobs.toLocaleString("en-ZA")}</b> open roles out of the {s.kpis.jobs.toLocaleString("en-ZA")} we track.</>,
      bars: byJobs.map((f) => ({ label: f.family, value: f.jobs, shown: `${f.jobs} roles` })),
    },
    {
      q: "Where in South Africa is hiring busiest?",
      text: <><b>{provs[0].province}</b> has <b>{share}%</b> of the {s.kpis.jobs.toLocaleString("en-ZA")} open roles we track.</>,
      bars: provs.map((p) => ({ label: p.province, value: p.jobs, shown: `${p.jobs} roles` })),
    },
  ];
  if (skills.length) qas.push({
    q: "Which skills do employers ask for most?",
    text: <><b>{skills[0].name}</b> appears in <b>{skills[0].jobs}</b> ads, ahead of {skills[1]?.name ?? "the rest"}.</>,
    bars: skills.map((k) => ({ label: k.name, value: k.jobs, shown: `${k.jobs} ads` })),
  });
  qas.push({
    q: "Which jobs could AI take the most work off?",
    text: <>From our Automation Index proof of concept: <b>{byScore[0].family}</b>, where about <b>{byScore[0].avg_score}%</b> of the work is automatable.</>,
    bars: byScore.map((f) => ({ label: f.family, value: f.avg_score, shown: `${f.avg_score}/100` })),
  });
  return qas;
}

function AskConsole({ s }: { s: Snapshot | null }) {
  const qas = useMemo(() => (s ? buildQAs(s) : []), [s]);
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<"typing" | "thinking" | "answer">("typing");
  const timer = useRef<number>(0);

  useEffect(() => {
    if (!qas.length) return;
    const qa = qas[i];
    window.clearTimeout(timer.current);
    if (reduced) { setTyped(qa.q.length); setPhase("answer"); return; }
    if (phase === "typing") {
      if (typed < qa.q.length) timer.current = window.setTimeout(() => setTyped((t) => t + 1), 26);
      else timer.current = window.setTimeout(() => setPhase("thinking"), 250);
    } else if (phase === "thinking") {
      timer.current = window.setTimeout(() => setPhase("answer"), 800);
    } else {
      timer.current = window.setTimeout(() => { setI((i + 1) % qas.length); setTyped(0); setPhase("typing"); }, 6500);
    }
    return () => window.clearTimeout(timer.current);
  }, [qas, i, typed, phase]);

  const pick = (n: number) => { setI(n); setTyped(0); setPhase("typing"); };
  const qa = qas[i];
  const max = qa ? Math.max(...qa.bars.map((b) => b.value)) : 1;

  return (
    <div className="console reveal d2" aria-label="Live demo: ask questions about South African job-market data">
      <div className="top mono">
        <span className="dots"><i /><i /><i /></span>
        <span>acolyte · ask your data</span>
        <span className="live"><i />LIVE</span>
      </div>
      <div className="body">
        {qa ? (
          <>
            <div className="q">{qa.q.slice(0, typed)}{phase === "typing" && <span className="caret" />}</div>
            {phase === "thinking" && <div className="thinking"><i /><i /><i /></div>}
            {phase === "answer" && (
              <div className="a fadein" key={i}>
                <div className="who mono"><img src={url("/favicon.svg")} alt="" />acolyte analyst</div>
                <p>{qa.text}</p>
                <div className="abars">
                  {qa.bars.map((b) => (
                    <div className="r" key={b.label}>
                      <span>{b.label}</span><span className="v">{b.shown}</span>
                      <div className="t"><div className="f" style={{ width: `${(100 * b.value) / max}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : <div className="thinking"><i /><i /><i /></div>}
      </div>
      <div className="ask">
        {qas.map((x, n) => (
          <button key={n} className={`chip ${n === i ? "on" : ""}`} onClick={() => pick(n)}>{x.q.replace(/\?$/, "")}</button>
        ))}
      </div>
      <div className="src mono">
        Demonstration: answers computed live on SA job-ad data{s ? ` · updated ${new Date(s.generated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : ""}{s?.meta.has_demo ? " · sample data" : ""}
      </div>
    </div>
  );
}

/* ---------------- Analytics bento ---------------- */

function Spark({ s }: { s: Snapshot | null }) {
  const pts = s?.trend.map((t) => t.jobs) ?? [3, 5, 4, 7, 6, 9, 8, 12, 10, 14, 13, 17];
  const w = 520, h = 150, max = Math.max(...pts, 1);
  const xy = pts.map((v, k) => [(k / Math.max(1, pts.length - 1)) * w, h - 8 - (v / max) * (h - 24)]);
  // smooth path
  const d = xy.reduce((acc, [x, y], k) => {
    if (k === 0) return `M${x},${y}`;
    const [px, py] = xy[k - 1]; const cx = (px + x) / 2;
    return `${acc} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, "");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c8f135" stopOpacity=".28" /><stop offset="1" stopColor="#c8f135" stopOpacity="0" /></linearGradient></defs>
      {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} />)}
      <path className="area" d={`${d} L${w},${h} L0,${h} Z`} />
      <path className="line" d={d} />
    </svg>
  );
}

function Bento({ s }: { s: Snapshot | null }) {
  return (
    <div className="bento">
      <article className="tile t-dash reveal" onMouseMove={spotlight}>
        <span className="tag live">Live</span>
        <span className="num">01 · Automated dashboards</span>
        <h3>Dashboards that build <em>themselves</em>.</h3>
        <p>We connect your sales, finance, stock and CRM data, clean it every night, and keep one live dashboard everyone trusts. No more copying numbers into Excel.</p>
        <div className="viz dash">
          <div className="k">{s ? rands(s.kpis.automatable_value) : "R—"}<small>of automatable work tracked in our own Automation Index proof of concept, refreshed every morning</small></div>
          <Spark s={s} />
        </div>
      </article>

      <article className="tile t-chat reveal d1" onMouseMove={spotlight}>
        <span className="tag">Example</span>
        <span className="num">02 · Chat with your data</span>
        <h3>Ask in plain English. <em>Or WhatsApp.</em></h3>
        <p>An AI analyst connected to your own numbers, available to anyone on the team.</p>
        <div className="viz wa">
          <div className="me">How did Durban branches do last week?<span className="time">07:42</span></div>
          <div className="bot">Sales up <b>12%</b> on the week before. Umhlanga led; Pinetown is down 4% on stock-outs.<span className="time">07:42</span></div>
        </div>
      </article>

      <article className="tile t-sent reveal" onMouseMove={spotlight}>
        <span className="tag">Example</span>
        <span className="num">03 · Sentiment analysis</span>
        <h3>Hear what customers <em>actually</em> say.</h3>
        <p>Reviews, social posts, support tickets and surveys, sorted by mood and topic, with alerts when something spikes.</p>
        <div className="viz sent">
          <div className="bar"><i className="pos" style={{ width: "58%", background: "#c8f135" }} /><i style={{ width: "24%", background: "#7cc4ff" }} /><i style={{ width: "18%", background: "#ff6a3d" }} /></div>
          <div className="rv">
            <div><span className="pill-s pos">pos</span>"Delivery was a day early, great service."</div>
            <div><span className="pill-s neg">neg</span>"App keeps logging me out since the update."</div>
            <div><span className="pill-s neu">neu</span>"Is the Sandton branch open on Sunday?"</div>
          </div>
        </div>
      </article>

      <article className="tile t-comp reveal d1" onMouseMove={spotlight}>
        <span className="tag">Example</span>
        <span className="num">04 · Competitor intelligence</span>
        <h3>Know when competitors <em>move</em>.</h3>
        <p>Prices, promotions, new products, reviews and hiring, tracked daily and summarised for you.</p>
        <div className="viz">
          <table className="comp"><tbody>
            <tr><td>Brand A · 2kg special</td><td>R89.99</td><td className="down">▼ 8%</td></tr>
            <tr><td>Brand B · new outlet</td><td>Gqeberha</td><td className="up">new</td></tr>
            <tr><td>Brand C · review score</td><td>3.9★</td><td className="down">▼ 0.3</td></tr>
          </tbody></table>
        </div>
      </article>

      <article className="tile t-rep reveal d2" onMouseMove={spotlight}>
        <span className="tag">Example</span>
        <span className="num">05 · AI-written reports</span>
        <h3>Monday, <em>07:00</em>. Report's in.</h3>
        <p>Branded PDF and Excel packs with commentary written by AI, sent to each person with only their numbers.</p>
        <div className="viz">
          <div className="rep">
            <div className="h"><span>WEEKLY PACK · WK 46</span><span>p.1</span></div>
            <b>Revenue up 6.4%, margin steady</b>
            <div className="ln" style={{ width: "92%" }} /><div className="ln" style={{ width: "78%" }} /><div className="ln" style={{ width: "85%" }} />
            <div className="bars">{[40, 55, 48, 62, 58, 70, 86].map((v, k) => <i key={k} style={{ height: `${v}%` }} />)}</div>
          </div>
        </div>
      </article>
    </div>
  );
}

/* ---------------- Your analyst ---------------- */

const ROLES = ["data analyst.", "talent analyst.", "property analyst.", "pricing analyst.", "Amazon analyst."];

/** The hero's job title cycles through the analysts Acolyte offers. */
function RotatingRole() {
  const [i, setI] = useState(0);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (reduced) return;
    let t2 = 0;
    const t = window.setInterval(() => {
      setOut(true);
      t2 = window.setTimeout(() => { setI((n) => (n + 1) % ROLES.length); setOut(false); }, 380);
    }, 2600);
    return () => { clearInterval(t); clearTimeout(t2); };
  }, []);
  return (
    <span className="rot" aria-label={ROLES.join(" ")}>
      <em className={out ? "out" : ""} aria-hidden="true">{ROLES[i]}</em>
    </span>
  );
}

const ANALYSTS: { name: string; status: string; href?: string; cta?: string; text: string; points: string[] }[] = [
  { name: "Talent Analyst", status: "Live", href: "/analyst/?industry=jobs", cta: "Try the Talent Analyst",
    text: "For HR, recruitment, training and B2B sales teams. Works on your hiring and HR data; shown here on SA job ads.",
    points: ["Hiring demand by role, sector and region", "Skills, tools and salaries employers ask for", "Who's hiring, and automation potential by role"] },
  { name: "Property Analyst", status: "Live", href: "/property/", cta: "See the Property Analyst",
    text: "For estate agencies, developers, banks and investors. Works on your listings and sales; shown here on the SA listings market.",
    points: ["A Daily Property Brief, ready at 07:00", "Stock, asking prices, rents and gross yields", "Agency share and price cuts by region"] },
  { name: "Retail Pricing Analyst", status: "Live", href: "/analyst/?industry=retail", cta: "Try the Pricing Analyst",
    text: "For FMCG brands, suppliers and category managers. Works on your prices and sales; shown here on everyday-item prices across SA retailers.",
    points: ["Price index and basket cost by retailer", "Price gaps by channel: grocery, wholesale, pharmacy", "Price moves and likely promotions"] },
  { name: "Marketplace Analyst", status: "Live", href: "/analyst/?industry=marketplace", cta: "Try the Marketplace Analyst",
    text: "For brands and sellers on Amazon.co.za and Takealot. Works on your Seller Central and Seller Portal reports; shown here on marketplace vs shop prices.",
    points: ["Amazon.co.za vs Takealot head-to-head", "Marketplace vs cheapest store, by item", "Seller pricing, ratings and coverage"] },
];

const LEVELS = [
  { level: "Analyst", text: "Everyday answers", points: ["150 questions a day", "2 report packs a day, 8 a week", "3 live dashboards"] },
  { level: "Data Scientist", text: "Strategy and research", points: ["400 questions a day", "6 report packs a day, 25 a week", "10 live dashboards, our most capable model"] },
];

const DOES = [
  { t: "Answers in plain English", x: "and shows the SQL behind every number" },
  { t: "Charts on request", x: "ranked, trended, mapped, compared" },
  { t: "Live dashboards", x: "pin any chart; it refreshes itself" },
  { t: "Report packs", x: "5-slide executive brief or full PowerPoint pack" },
  { t: "Checks its own work", x: "every figure traced back to the data" },
  { t: "Your data, read-only", x: "spreadsheets, Google Sheets or your database; never copied out" },
];

/* ---------------- Sample reports (monthly packs, published by the reports workflow) ---------------- */

function SampleReports() {
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  useEffect(() => { loadIndex().then((rs) => setCards(latestPerAnalyst(rs))); }, []);
  return (
    <section id="reports" className="samples">
      <div className="inner">
        <div className="row-head">
          <div>
            <span className="eyebrow">Sample reports</span>
            <h2>This month's reports, <em>free to read.</em></h2>
            <p className="lede">Every analyst publishes a monthly report pack on our demonstration market data: what changed, trends and patterns, a 5-month look-back on demand, and actions for the month ahead. It's the same pack it would write on your data. Download any of them as PowerPoint or PDF.</p>
          </div>
          <a className="btn-signal" href={url("/reports/")}>See all reports &amp; dashboards <span className="arr">→</span></a>
        </div>
        {cards && cards.length ? (
          <div className="sample-grid">
            {cards.map((r) => (
              <a key={r.id} className="sample" href={url(`/reports/#report-${r.id}`)}>
                <span className="st mono">{REPORT_ANALYSTS[r.industry]?.name || r.analyst} · {monthLabel(r.period, r.month_to_date)}</span>
                <h3>{r.title}</h3>
                {r.takeaway && <p>{r.takeaway.length > 170 ? r.takeaway.slice(0, 167) + "…" : r.takeaway}</p>}
                <div className="sk">{r.kpis.slice(0, 2).map((k, i) => <div key={i}><b>{k.value}</b><span>{k.label}</span></div>)}</div>
                <span className="go">Read the report <span className="arr">→</span></span>
              </a>
            ))}
          </div>
        ) : (
          <p className="sample-empty">{cards === null ? "Loading reports…" : "The first editions are being written. They'll appear here as soon as they're published."}</p>
        )}
      </div>
    </section>
  );
}

/* ---------------- Datasets and use cases ---------------- */

const USE_CASES: { title: string; status: "Live" | "Proof of concept" | "Next" | "Retail data"; text: string; who: string; href?: string }[] = [
  { title: "SA Job Market Analysis", status: "Live", href: "/analyst/?industry=jobs",
    text: "Which roles, sectors and cities are hiring, and how demand is moving week to week.", who: "HR leaders · recruiters · investors · media" },
  { title: "Automation Opportunity Index", status: "Proof of concept", href: "/automation-index/",
    text: "How much of each advertised role AI could take on, and what that work is worth in rand a year.", who: "COOs · finance and operations leads" },
  { title: "Who's Hiring", status: "Live", href: "/employers/",
    text: "Every direct employer behind the ads, with profile, open roles, tools and location.", who: "Sales teams · partnerships · recruiters" },
  { title: "Skills & Tools Demand", status: "Live", href: "/tools/",
    text: "The software, skills and qualifications employers ask for, by role and seniority.", who: "Universities · training providers · SETAs" },
  { title: "Hiring Signals for Sales", status: "Next",
    text: "Companies whose hiring points to a buying need, delivered as a weekly prospect list.", who: "Software vendors · consultancies · banks" },
  { title: "Regional Hiring Pulse", status: "Next",
    text: "Hiring momentum by province and metro, as an early read on local economic activity.", who: "Investors · property · municipalities" },
  { title: "Property Market Pulse", status: "Live", href: "/property/",
    text: "Asking prices, rents and stock by province, region and suburb, with price cuts tracked daily.", who: "Agencies · developers · banks · investors" },
  { title: "Rental Yield Finder", status: "Live", href: "/analyst/?industry=property",
    text: "Where rents are high against asking prices, by region, property type and bedrooms.", who: "Buy-to-let investors · property funds" },
  { title: "SA Basket Index", status: "Next",
    text: "Monthly food inflation from real shelf prices, compared with Stats SA's CPI.", who: "Economists · banks · media · NGOs" },
  { title: "Retailer Price Comparison", status: "Live", href: "/analyst/?industry=retail",
    text: "Who is cheapest for the same basket, by category and region, tracked daily.", who: "Retailers · consumers · FMCG brands" },
  { title: "Amazon.co.za vs Takealot", status: "Live", href: "/analyst/?industry=marketplace",
    text: "Which marketplace is cheaper on everyday items, and how both compare with the shops.", who: "Brands · marketplace sellers" },
  { title: "Promotions & Shelf Tracker", status: "Next",
    text: "Promotion frequency, price position, and house brands against name brands.", who: "FMCG brands · agencies" },
];

/* ---------------- Automation services (secondary) ---------------- */

const AUTOMATIONS = [
  { title: "AI agents for WhatsApp & web", text: "Answer routine customer questions and hand complex cases to your team with full context.", roles: "call centre · customer service · front desk" },
  { title: "Invoice & document processing", text: "Read invoices, claims, IDs and forms, check them, and capture them straight into your systems.", roles: "data capture · claims · creditors" },
  { title: "Finance & month-end", text: "Invoice matching, reconciliations and statements, connected to Sage, Pastel, Xero and your bank.", roles: "bookkeeping · creditors & debtors · payroll" },
  { title: "Collections & reminders", text: "Polite, automatic reminders by WhatsApp, SMS and email, with payment links.", roles: "collections · credit control" },
  { title: "Compliance workflows", text: "FICA/KYC checks and audit trails that run the same way every time, with people approving exceptions.", roles: "compliance · onboarding" },
  { title: "Sales admin & quoting", text: "Quotes built from price lists and orders captured into your CRM automatically.", roles: "sales admin · order processing" },
];

function Calculator() {
  const [people, setPeople] = useState(4);
  const [salary, setSalary] = useState(18000);
  const [pct, setPct] = useState(50);
  const annual = people * salary * 12 * 1.25 * (pct / 100);
  const hours = Math.round(people * 173 * (pct / 100));
  return (
    <div className="calc reveal">
      <div className="panel">
        <div className="field"><label>People doing the work <span>{people}</span></label>
          <input type="range" min={1} max={50} value={people} onChange={(e) => setPeople(+e.target.value)} /></div>
        <div className="field"><label>Average monthly salary <span>R{salary.toLocaleString("en-ZA")}</span></label>
          <input type="range" min={6000} max={60000} step={1000} value={salary} onChange={(e) => setSalary(+e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 8 }}><label>Time on repetitive tasks <span>{pct}%</span></label>
          <input type="range" min={10} max={90} step={5} value={pct} onChange={(e) => setPct(+e.target.value)} /></div>
        <p style={{ color: "var(--mute)", fontSize: 14, margin: "16px 0 0" }}>Capturing data, copying between systems, building the same report, chasing payments, answering the same questions.</p>
      </div>
      <div className="panel result">
        <div className="k">Annual cost of repetitive work</div>
        <div className="v">{rands(annual)}</div>
        <div className="k">Team time spent on it</div>
        <div className="v2">{hours.toLocaleString("en-ZA")} hours / month</div>
        <small>Salary × 1.25 for cost-to-company. An estimate, not a quote.</small>
        <a className="btn-signal" href="#contact">Get a real estimate <span className="arr">→</span></a>
      </div>
    </div>
  );
}

/* ---------------- Contact: the shared Contact sales form (src/contact/ContactForm.tsx) ---------------- */

/* ---------------- Page ---------------- */

const MARQUEE = ["SA job market", "Retail prices", "Automated dashboards", "Sentiment analysis", "Competitor intelligence", "Chat with your data", "AI-written reports", "WhatsApp alerts", "Process automation"];

export default function Landing() {
  const s = useSnapshot();
  useReveal(s);
  return (
    <div className="lp">
      <nav className="bar">
        <div className="inner">
          <a className="logo" href={url("/")}><img src={url("/favicon.svg")} alt="" />acolyte</a>
          <div className="pill links">
            <a href="#analyst">Your analyst</a>
            <a href={url("/reports/")}>Reports</a>
            <a href="#use-cases">Use cases</a>
            <a href={url("/analyst/")}>Ask AI</a>
            <a href="#automation">Automation</a>
            <a className="btn-signal" href="#contact">Book a session</a>
          </div>
        </div>
      </nav>

      <section className="hero">
        <MatrixRain />
        <div className="glow" />
        <div className="inner">
          <div>
            <span className="eyebrow reveal">AI data analyst · South Africa</span>
            <h1 className="reveal d1">Your own AI<br /><RotatingRole /></h1>
            <p className="lede reveal d2">
              An AI data analyst for your data. Watch it work here on live South African market data (talent, property, retail pricing and
              marketplaces), then point it at your own: a spreadsheet, a Google Sheet or your database. Ask in plain English and get answers,
              charts, live dashboards and board-ready report packs in minutes.
            </p>
            <div className="actions reveal d3">
              <a className="btn-signal" href="#contact">Book a free data session <span className="arr">→</span></a>
              <a className="btn-line" href={url("/analyst/")}>Try your analyst now</a>
            </div>
            <div className="meta mono reveal d3">
              <span><b>Answers</b> in seconds</span><span><b>PowerPoint</b> packs</span><span><b>Live</b> dashboards</span><span><b>POPIA</b>-aware</span>
            </div>
          </div>
          <AskConsole s={s} />
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="track">{[...MARQUEE, ...MARQUEE].map((m, k) => <span key={k}>{m}</span>)}</div>
      </div>


      <section id="analytics">
        <div className="inner">
          <span className="eyebrow reveal">What we build</span>
          <h2 className="reveal d1">Analytics that <em>works for you</em>, not the other way round.</h2>
          <p className="lede reveal d2">Most businesses already have the data. It's stuck in Sage, spreadsheets, reviews and inboxes. We connect it, let AI read it, and put the answers where your team already works.</p>
          <Bento s={s} />
        </div>
      </section>

      <section id="analyst" className="hire">
        <div className="inner">
          <span className="eyebrow reveal">Pick your analyst</span>
          <h2 className="reveal d1">One analyst per industry, <em>yours from day one.</em></h2>
          <p className="lede reveal d2">Each analyst is a separate subscription that knows its industry and works on your data: your listings, sales,
            prices or hiring. Try it here first on South African market data. No hiring round, no onboarding: it queries the data, shows its working,
            and hands over the chart, dashboard or pack you asked for.</p>
          <div className="roles2 four">
            {ANALYSTS.map((a, k) => (
              <article key={a.name} className={`role reveal d${k} ${a.href ? "" : "soon"}`}>
                <span className="lvl mono">{a.status}</span>
                <h3>{a.name}</h3>
                <p>{a.text}</p>
                <ul>{a.points.map((x) => <li key={x}>{x}</li>)}</ul>
                {a.href ? <a className="go" href={url(a.href)}>{a.cta} <span className="arr">→</span></a>
                  : <a className="go" href="#contact">Join the waiting list <span className="arr">→</span></a>}
              </article>
            ))}
          </div>
          <div className="levels reveal">
            <span className="mono">Every analyst comes in two levels</span>
            {LEVELS.map((l) => <div key={l.level}><b>{l.level}</b><em>{l.text}</em><span>{l.points.join(" · ")}</span></div>)}
          </div>
          <p className="more reveal">Plans are for the analyst and its tools, not for data. The South African market data on this site is there to show what an
            analyst can do; for your business it works on data you own or license, connected read-only and kept private to your account.</p>
          <div className="does reveal">
            {DOES.map((d) => <div key={d.t}><b>{d.t}</b><span>{d.x}</span></div>)}
          </div>
          <div className="actions reveal">
            <a className="btn-signal" href="#contact">Hire your analyst <span className="arr">→</span></a>
            <a className="btn-line" href={url("/analyst/")}>Ask it a question first</a>
          </div>
        </div>
      </section>

      <SampleReports />

      <section id="how">
        <div className="inner">
          <span className="eyebrow reveal">How it works</span>
          <h2 className="reveal d1">From scattered data to <em>answers</em> in weeks.</h2>
          <div className="steps">
            <div className="step reveal"><div className="n">i.</div><h3>Connect</h3><p>We plug into the systems you already use, with read-only access wherever possible.</p>
              <div className="sources">{["Sage", "Pastel", "Xero", "Excel", "Google Sheets", "Shopify", "CRM", "Google reviews", "App stores", "Social"].map((x) => <span key={x}>{x}</span>)}</div></div>
            <div className="step reveal d1"><div className="n">ii.</div><h3>Build</h3><p>We model your numbers, set up the dashboards, sentiment and competitor tracking, and train the AI analyst on your data.</p></div>
            <div className="step reveal d2"><div className="n">iii.</div><h3>Ask</h3><p>Your team gets live dashboards, scheduled reports and an analyst on web or WhatsApp. We monitor and improve it monthly.</p></div>
          </div>
        </div>
      </section>

      <section className="proof ink" id="use-cases">
        <div className="inner">
          <div className="row">
            <div>
              <span className="eyebrow reveal">What your analyst can do</span>
              <h2 className="reveal d1">One analyst, <em>many</em> jobs done.</h2>
              <p className="lede reveal d2">Each analyst arrives knowing its industry: the questions to ask, the expert methods to answer them, the dashboards
                to keep and the packs to write. Watch it work below, then give it your own data: a spreadsheet, a Google Sheet or a read-only database.</p>
            </div>
            <a className="btn-signal reveal" href={url("/analyst/")}>Ask your analyst <span className="arr">→</span></a>
          </div>
          <div className="grid reveal">
            <div className="stat"><div className="v">4</div><div className="l">industry analysts: talent, property, retail pricing, marketplaces</div></div>
            <div className="stat"><div className="v">5</div><div className="l">expert skills each, from rental yield screens to price-gap checks</div></div>
            <div className="stat"><div className="v">07:00</div><div className="l">a written brief, before your first meeting</div></div>
            <div className="stat"><div className="v">Seconds</div><div className="l">from a plain-English question to a chart or a pack</div></div>
          </div>
          <div className="uses">
            {USE_CASES.map((u, k) => {
              const body = <>
                <span className={`st mono ${u.status.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{u.status}</span>
                <h3>{u.title}</h3>
                <p>{u.text}</p>
                <span className="who mono">{u.who}</span>
                {u.href && <span className="go">Open <span className="arr">→</span></span>}
              </>;
              return u.href
                ? <a key={u.title} className={`use reveal d${k % 3}`} href={url(u.href)}>{body}</a>
                : <div key={u.title} className={`use reveal d${k % 3}`}>{body}</div>;
            })}
          </div>
          <p className="more reveal">Each of these is shown on public South African market data. Have a question none of them answers? <a href="#contact">Tell us</a> and we'll set your analyst up for it, on your own data.</p>
          {s?.meta.has_demo && <div className="note">Currently showing sample data while live collection starts.</div>}
        </div>
      </section>

      <section id="automation" style={{ paddingTop: 40 }}>
        <div className="inner">
          <span className="eyebrow reveal">And when the data shows the bottleneck</span>
          <h2 className="reveal d1">We <em>automate</em> the work behind it.</h2>
          <p className="lede reveal d2">Analytics shows where the hours go. Our automation team takes the repetitive work off your people, so they can focus on clients and decisions.</p>
          <div className="auto">
            {AUTOMATIONS.map((a, k) => (
              <div key={a.title} className={`reveal d${k % 3}`}><h3>{a.title}</h3><p>{a.text}</p><div className="roles">{a.roles}</div></div>
            ))}
          </div>
          <Calculator />
        </div>
      </section>

      <BigStat />

      <section id="contact">
        <div className="inner contact">
          <div>
            <span className="eyebrow reveal">Get started</span>
            <h2 className="reveal d1">Let's make your data <em>talk.</em></h2>
            <p className="lede reveal d2">Book a free 30-minute data session. Bring one question you can't answer today, and we'll show you how quickly it could be.</p>
            <div className="contact-points">
              {SITE.email && <div><b>Email</b><a href={`mailto:${SITE.email}`}>{SITE.email}</a></div>}
              {SITE.phone && <div><b>Phone / WhatsApp</b>{SITE.phone}</div>}
              {SITE.city && <div><b>Based in</b>{SITE.city}, working across South Africa</div>}
            </div>
          </div>
          <ContactForm />
        </div>
      </section>

      <footer className="site">
        <div className="inner" style={{ display: "block" }}>
          <div className="big">acolyte<span>.</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
            <span>© {new Date().getFullYear()} {SITE.legalName || SITE.name}{SITE.regNumber ? ` · Reg. ${SITE.regNumber}` : ""}</span>
            <span><a href="#use-cases">Use cases</a> · <a href={url("/analyst/")}>Ask AI</a> · <a href={url("/automation-index/")}>Automation index</a> · <a href={url("/employers/")}>Employers</a> · <a href={url("/tools/")}>Tools &amp; skills</a> · <a href={url("/privacy/")}>Privacy</a> · Jobs data by <a href="https://www.adzuna.co.za" target="_blank" rel="noreferrer">Adzuna</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
