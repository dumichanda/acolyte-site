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
  const byScore = [...fams].sort((a, b) => b.avg_score - a.avg_score).slice(0, 4);
  const provs = s.by_province.filter((p) => p.province !== "Unknown").slice(0, 4);
  const share = Math.round((100 * (provs[0]?.jobs ?? 0)) / Math.max(1, s.kpis.jobs));
  const byValue = [...fams].sort((a, b) => b.value - a.value).slice(0, 4);
  const focus = [...fams].sort((a, b) => b.value * b.avg_score - a.value * a.avg_score)[0];
  return [
    {
      q: "Which jobs could AI take the most work off right now?",
      text: <>Top of the list is <b>{byScore[0].family}</b>: about <b>{byScore[0].avg_score}%</b> of the work in those roles is automatable.</>,
      bars: byScore.map((f) => ({ label: f.family, value: f.avg_score, shown: `${f.avg_score}/100` })),
    },
    {
      q: "Where in South Africa is hiring busiest?",
      text: <><b>{provs[0].province}</b> has <b>{share}%</b> of the {s.kpis.jobs.toLocaleString("en-ZA")} open roles we track.</>,
      bars: provs.map((p) => ({ label: p.province, value: p.jobs, shown: `${p.jobs} roles` })),
    },
    {
      q: "How much is the automatable work worth?",
      text: <>Roughly <b>{rands(s.kpis.automatable_value)} a year</b> in salary cost, across {s.kpis.companies} employers.</>,
      bars: byValue.map((f) => ({ label: f.family, value: f.value, shown: rands(f.value) })),
    },
    {
      q: "Where should we focus first?",
      text: <><b>{focus.family}</b>: high automation potential ({focus.avg_score}/100) and {rands(focus.value)} a year at stake.</>,
      bars: [...fams].sort((a, b) => b.value * b.avg_score - a.value * a.avg_score).slice(0, 3)
        .map((f) => ({ label: f.family, value: f.value * f.avg_score, shown: `${f.avg_score}/100` })),
    },
  ];
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
        Answers computed live from the SA Automation Opportunity Index{s ? ` · updated ${new Date(s.generated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}` : ""}{s?.meta.has_demo ? " · sample data" : ""}
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
          <div className="k">{s ? rands(s.kpis.automatable_value) : "R—"}<small>tracked live in our own index, refreshed every morning</small></div>
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
const INTERESTS = ["Automated dashboards & reports", "Chat with your data", "Sentiment analysis", "Competitor intelligence", "Process automation", "Not sure yet"];

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

const MARQUEE = ["Automated dashboards", "Sentiment analysis", "Competitor intelligence", "Chat with your data", "AI-written reports", "WhatsApp alerts", "Process automation"];

export default function Landing() {
  const s = useSnapshot();
  useReveal(s);
  return (
    <div className="lp">
      <nav className="bar">
        <div className="inner">
          <a className="logo" href={url("/")}><img src={url("/favicon.svg")} alt="" />acolyte</a>
          <div className="pill links">
            <a href="#analytics">AI analytics</a>
            <a href={url("/automation-index/")}>Live index</a>
            <a href={url("/employers/")}>Who's hiring</a>
            <a href="#automation">Automation</a>
            <a className="btn-signal" href="#contact">Book a session</a>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="glow" />
        <div className="inner">
          <div>
            <span className="eyebrow reveal">AI analytics · South Africa</span>
            <h1 className="reveal d1">Your data,<br /><em>talking back.</em></h1>
            <p className="lede reveal d2">
              Acolyte builds AI analytics for South African businesses: dashboards that update themselves, sentiment and
              competitor tracking, and an AI analyst your team can simply ask.
            </p>
            <div className="actions reveal d3">
              <a className="btn-signal" href="#contact">Book a free data session <span className="arr">→</span></a>
              <a className="btn-line" href={url("/automation-index/")}>Explore the live index</a>
            </div>
            <div className="meta mono reveal d3">
              <span><b>Daily</b> refresh</span><span><b>WhatsApp</b> ready</span><span><b>POPIA</b>-aware</span>
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

      <section className="proof">
        <div className="inner">
          <div className="row">
            <div>
              <span className="eyebrow reveal">Proof, not promises</span>
              <h2 className="reveal d1">We run our own <em>live</em> AI analytics.</h2>
              <p className="lede reveal d2">The SA Automation Opportunity Index collects job postings across South Africa every morning, has AI score each role, and publishes the dashboard and PDF report automatically. Built and run the way we'd build yours.</p>
            </div>
            <a className="btn-signal reveal" href={url("/automation-index/")}>Open the live index <span className="arr">→</span></a>
          </div>
          {s && (
            <div className="grid reveal">
              <div className="stat"><div className="v"><CountUp to={s.kpis.jobs} /></div><div className="l">open roles tracked</div></div>
              <div className="stat"><div className="v"><CountUp to={s.kpis.automatable_value} format={rands} /></div><div className="l">automatable work / year</div></div>
              <div className="stat"><div className="v"><CountUp to={s.kpis.avg_score} />%</div><div className="l">average automation score</div></div>
              <div className="stat"><div className="v"><CountUp to={s.kpis.companies} /></div><div className="l">employers analysed</div></div>
            </div>
          )}
          <a className="shot reveal" href={url("/automation-index/")}><img src={url("/img/index-preview.png")} alt="The SA Automation Opportunity Index dashboard" loading="lazy" /></a>
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
            <span><a href={url("/automation-index/")}>Live index</a> · <a href={url("/employers/")}>Employers</a> · <a href={url("/tools/")}>Tools &amp; skills</a> · <a href={url("/privacy/")}>Privacy</a> · Jobs data by <a href="https://www.adzuna.co.za" target="_blank" rel="noreferrer">Adzuna</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}
