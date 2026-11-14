import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import type { Snapshot } from "../types";
import { rands } from "../types";
import { SITE, url } from "../site";

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

function CountUp({ to, format = (n: number) => Math.round(n).toLocaleString("en-ZA") }: { to: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(reduced ? to : 0);
  useEffect(() => {
    if (reduced || !ref.current) { setV(to); return; }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 1600);
        setV(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(ref.current);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{format(v)}</span>;
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
        Answers computed live from Acolyte's SA jobs dataset{s ? ` · updated ${new Date(s.generated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : ""}{s?.meta.has_demo ? " · sample data" : ""}
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
    text: "For HR, recruitment, training and B2B sales teams. Knows every SA job ad we track.",
    points: ["Hiring demand by role, sector and region", "Skills, tools and salaries employers ask for", "Who's hiring, and automation potential by role"] },
  { name: "Property Analyst", status: "Live", href: "/property/", cta: "See the Property Analyst",
    text: "For estate agencies, developers, banks and investors. Reads the whole SA listings market every morning.",
    points: ["A Daily Property Brief, ready at 07:00", "Stock, asking prices, rents and gross yields", "Agency share and price cuts by region"] },
  { name: "Retail Pricing Analyst", status: "Live", href: "/analyst/?industry=retail", cta: "Try the Pricing Analyst",
    text: "For FMCG brands, suppliers and category managers. Everyday-item prices across SA retailers, every morning.",
    points: ["Price index and basket cost by retailer", "Price gaps by channel: grocery, wholesale, pharmacy", "Price moves and likely promotions"] },
  { name: "Marketplace Analyst", status: "Live", href: "/analyst/?industry=marketplace", cta: "Try the Marketplace Analyst",
    text: "For brands and sellers on Amazon.co.za and Takealot. Marketplace prices against the shops, every morning.",
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
];

/* ---------------- Datasets and use cases ---------------- */

const DATASETS = [
  { name: "SA jobs", live: true, text: "" },
  { name: "SA property", live: true, text: "Listings, asking prices, rents and stock across all 9 provinces and 48 regions, refreshed daily" },
  { name: "SA retail prices", live: true, text: "Everyday-item prices across SA grocery chains, wholesalers, pharmacies, Amazon.co.za and Takealot, daily" },
];

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

/* ---------------- Contact ---------------- */

type Status = "idle" | "sending" | "sent" | "error";
const INTERESTS = ["SA market data (jobs, retail)", "Automated dashboards & reports", "Chat with your data", "Sentiment analysis", "Competitor intelligence", "Process automation", "Not sure yet"];

function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const data = new FormData(e.currentTarget);
    if (!SITE.formEndpoint) {
      if (SITE.email) {
        const body = [...data.entries()].filter(([k]) => k !== "_gotcha").map(([k, v]) => `${k}: ${v}`).join("\n");
        location.href = `mailto:${SITE.email}?subject=${encodeURIComponent("Acolyte enquiry")}&body=${encodeURIComponent(body)}`;
        setStatus("idle");
      } else setStatus("error");
      return;
    }
    try {
      const r = await fetch(SITE.formEndpoint, { method: "POST", body: data, headers: { Accept: "application/json" } });
      setStatus(r.ok ? "sent" : "error");
    } catch { setStatus("error"); }
  }
  if (status === "sent") return <div className="msg ok">Thank you. We've got your message and will reply within one business day.</div>;
  return (
    <form className="f reveal d1" onSubmit={submit}>
      <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" style={{ display: "none" }} />
      <div><label htmlFor="name">Name</label><input id="name" name="name" required autoComplete="name" /></div>
      <div><label htmlFor="company">Company</label><input id="company" name="company" required autoComplete="organization" /></div>
      <div><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div><label htmlFor="phone">Phone / WhatsApp (optional)</label><input id="phone" name="phone" type="tel" autoComplete="tel" /></div>
      <div className="full"><label htmlFor="interest">I'm interested in</label>
        <select id="interest" name="interest" defaultValue=""><option value="" disabled>Choose one</option>{INTERESTS.map((x) => <option key={x}>{x}</option>)}</select></div>
      <div className="full"><label htmlFor="message">What data do you have, and what do you want to know?</label>
        <textarea id="message" name="message" placeholder="e.g. Sales in Sage and Shopify, reviews on Google. We want one weekly view by branch." /></div>
      <label className="consent full"><input type="checkbox" name="consent" value="yes" required />
        <span>I agree that Acolyte may use these details to respond to my enquiry, as set out in the <a href={url("/privacy/")}>privacy notice</a>. No mailing lists.</span></label>
      {status === "error" && <div className="msg err full">That didn't send. Please try again{SITE.email ? <> or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a></> : null}.</div>}
      <div className="full"><button className="btn-signal" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : <>Book a free data session <span className="arr">→</span></>}</button></div>
    </form>
  );
}

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
            <a href="#use-cases">Use cases</a>
            <a href={url("/analyst/")}>Ask AI</a>
            <a href="#automation">Automation</a>
            <a className="btn-signal" href="#contact">Book a session</a>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="glow" />
        <div className="inner">
          <div>
            <span className="eyebrow reveal">AI data analyst · South Africa</span>
            <h1 className="reveal d1">Your own AI<br /><RotatingRole /></h1>
            <p className="lede reveal d2">
              Hire an AI analyst for your industry, already trained on South African market data: talent, property, retail pricing and marketplaces.
              Ask in plain English and get answers, charts, live dashboards and board-ready report packs in minutes.
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
          <p className="lede reveal d2">Each analyst is a separate subscription, trained on its own South African market data. No hiring round,
            no onboarding: it queries the data, shows its working, and hands over the chart, dashboard or pack you asked for.</p>
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
          <div className="does reveal">
            {DOES.map((d) => <div key={d.t}><b>{d.t}</b><span>{d.x}</span></div>)}
          </div>
          <div className="actions reveal">
            <a className="btn-signal" href="#contact">Hire your analyst <span className="arr">→</span></a>
            <a className="btn-line" href={url("/analyst/")}>Ask it a question first</a>
          </div>
        </div>
      </section>

      <section className="proof" id="use-cases">
        <div className="inner">
          <div className="row">
            <div>
              <span className="eyebrow reveal">Use cases on live SA data</span>
              <h2 className="reveal d1">One platform, <em>many</em> use cases.</h2>
              <p className="lede reveal d2">We collect South African market data every morning, clean it and load it into one platform. Each use case is a view on that data, with its own dashboards, questions for the AI analyst and report packs. New datasets and use cases plug in without rebuilding anything.</p>
            </div>
            <a className="btn-signal reveal" href={url("/analyst/")}>Ask the data <span className="arr">→</span></a>
          </div>
          <div className="datasets reveal">
            {DATASETS.map((d) => (
              <div key={d.name} className={`ds ${d.live ? "live" : ""}`}>
                <span className="st mono">{d.live ? "Live dataset" : "Coming next"}</span>
                <b>{d.name}</b>
                <span>{d.name === "SA jobs" && s ? `${s.kpis.jobs.toLocaleString("en-ZA")} job ads · ${s.kpis.companies.toLocaleString("en-ZA")} employers · refreshed daily` : d.text}</span>
              </div>
            ))}
          </div>
          {s && (
            <div className="grid reveal">
              <div className="stat"><div className="v"><CountUp to={s.kpis.jobs} /></div><div className="l">open roles tracked</div></div>
              <div className="stat"><div className="v"><CountUp to={s.kpis.jobs_7d} /></div><div className="l">ads posted in the last 7 days</div></div>
              <div className="stat"><div className="v"><CountUp to={s.kpis.companies} /></div><div className="l">employers profiled</div></div>
              <div className="stat"><div className="v"><CountUp to={USE_CASES.filter((u) => u.href).length} /></div><div className="l">use cases live today</div></div>
            </div>
          )}
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
          <p className="more reveal">Have a dataset, or a question no use case answers yet? <a href="#contact">Tell us</a> and we'll build it on the same platform.</p>
          {s?.meta.has_demo && <div className="note">Currently showing sample data while live collection starts.</div>}
        </div>
      </section>

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
