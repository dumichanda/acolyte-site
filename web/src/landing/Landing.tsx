import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Snapshot } from "../types";
import { rands } from "../types";
import { SITE, url } from "../site";

const Icon = ({ d }: { d: string }) => (
  <div className="ico"><svg viewBox="0 0 24 24"><path d={d} /></svg></div>
);

const SERVICES: { title: string; text: string; roles: string; icon: string }[] = [
  {
    title: "AI agents for WhatsApp & web",
    text: "Answer routine customer questions, look up orders and accounts, and hand complex cases to your team with the full context.",
    roles: "Call centre · customer service · front desk",
    icon: "M4 5h16v10H8l-4 4V5z M8 9h8 M8 12h5",
  },
  {
    title: "Invoice & document processing",
    text: "Read invoices, claims, IDs and forms automatically, check them, and capture the data straight into your systems.",
    roles: "Data capturers · claims admin · creditors clerks",
    icon: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
  },
  {
    title: "Finance & month-end automation",
    text: "Invoice matching, reconciliations, payment runs and statements, connected to Sage, Pastel, Xero and your bank.",
    roles: "Bookkeepers · creditors & debtors · payroll",
    icon: "M4 19V9 M10 19V5 M16 19v-7 M22 19H2",
  },
  {
    title: "Collections & reminders",
    text: "Friendly, automatic reminders by WhatsApp, SMS and email with payment links, and promises-to-pay logged for you.",
    roles: "Collections agents · credit controllers",
    icon: "M12 8v4l3 2 M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9z",
  },
  {
    title: "Reporting & dashboards",
    text: "Live dashboards and scheduled PDF/Excel report packs with AI-written commentary, instead of copying numbers by hand.",
    roles: "Reporting analysts · management accountants",
    icon: "M3 3v18h18 M7 15l4-4 3 3 5-6",
  },
  {
    title: "Compliance workflows",
    text: "FICA/KYC document checks, screening and audit trails that run the same way every time, with people approving the exceptions.",
    roles: "Compliance & FICA admin · onboarding",
    icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4",
  },
];

function useSnapshot() {
  const [s, setS] = useState<Snapshot | null>(null);
  useEffect(() => {
    fetch(url("/data/snapshot.json")).then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null));
  }, []);
  return s;
}

function LiveCard({ s }: { s: Snapshot | null }) {
  if (!s) return <div className="live" style={{ minHeight: 360 }} aria-busy="true" />;
  const top = s.by_family.filter((f) => f.family !== "Other").slice(0, 5);
  const max = Math.max(...top.map((f) => f.value));
  return (
    <a className="live" href={url("/automation-index/")} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
      <span className="pulse"><i /> LIVE · SA AUTOMATION INDEX</span>
      <div className="big">{rands(s.kpis.automatable_value)}</div>
      <div className="cap">a year of automatable work in {s.kpis.jobs.toLocaleString("en-ZA")} open South African roles</div>
      <div className="bars">
        {top.map((f) => (
          <div className="row" key={f.family}>
            <span>{f.family}</span><span className="muted">{rands(f.value)}</span>
            <div className="track"><div className="fill" style={{ width: `${(100 * f.value) / max}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="foot">
        <span>Updated {new Date(s.generated_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long" })}</span>
        {s.meta.has_demo ? <span className="demo-note">Sample data</span> : <span>Explore the index →</span>}
      </div>
    </a>
  );
}

function Calculator() {
  const [people, setPeople] = useState(4);
  const [salary, setSalary] = useState(18000);
  const [pct, setPct] = useState(50);
  const annual = useMemo(() => people * salary * 12 * 1.25 * (pct / 100), [people, salary, pct]);
  const hours = Math.round(people * 173 * (pct / 100));
  return (
    <div className="calc">
      <div className="panel">
        <div className="field">
          <label>People doing the work <span>{people}</span></label>
          <input type="range" min={1} max={50} value={people} onChange={(e) => setPeople(+e.target.value)} />
        </div>
        <div className="field">
          <label>Average monthly salary <span>R{salary.toLocaleString("en-ZA")}</span></label>
          <input type="range" min={6000} max={60000} step={1000} value={salary} onChange={(e) => setSalary(+e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 6 }}>
          <label>Time spent on repetitive tasks <span>{pct}%</span></label>
          <input type="range" min={10} max={90} step={5} value={pct} onChange={(e) => setPct(+e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: 13, margin: "14px 0 0" }}>
          Repetitive tasks: capturing data, copying between systems, matching documents, chasing payments, answering the same questions.
        </p>
      </div>
      <div className="panel result">
        <div className="k">Annual cost of repetitive work</div>
        <div className="v">{rands(annual)}</div>
        <div className="k">Team time spent on it</div>
        <div className="v2">{hours.toLocaleString("en-ZA")} hours a month</div>
        <small>Salary × 1.25 for full cost-to-company. An estimate, not a quote: a free assessment gives you real numbers.</small>
        <a className="cta" href="#contact">Get a real estimate</a>
      </div>
    </div>
  );
}

type Status = "idle" | "sending" | "sent" | "error";

function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const data = new FormData(e.currentTarget);
    if (!SITE.formEndpoint) {
      // No form service configured yet: fall back to the visitor's email app, if we have an address.
      if (SITE.email) {
        const body = [...data.entries()].filter(([k]) => k !== "_gotcha").map(([k, v]) => `${k}: ${v}`).join("\n");
        location.href = `mailto:${SITE.email}?subject=${encodeURIComponent("Automation assessment request")}&body=${encodeURIComponent(body)}`;
        setStatus("idle");
      } else {
        setStatus("error");
      }
      return;
    }
    try {
      // Formspree (or any service that accepts multipart form posts and returns 2xx).
      const r = await fetch(SITE.formEndpoint, { method: "POST", body: data, headers: { Accept: "application/json" } });
      setStatus(r.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }
  if (status === "sent") {
    return <div className="msg ok">Thank you. We've received your message and will be in touch within one business day.</div>;
  }
  return (
    <form className="f" name="contact" method="POST" onSubmit={submit}>
      <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" style={{ display: "none" }} />
      <div><label htmlFor="name">Name</label><input id="name" name="name" required autoComplete="name" /></div>
      <div><label htmlFor="company">Company</label><input id="company" name="company" required autoComplete="organization" /></div>
      <div><label htmlFor="email">Work email</label><input id="email" name="email" type="email" required autoComplete="email" /></div>
      <div><label htmlFor="phone">Phone / WhatsApp <span className="muted">(optional)</span></label><input id="phone" name="phone" type="tel" autoComplete="tel" /></div>
      <div className="full">
        <label htmlFor="interest">What would you like to automate?</label>
        <select id="interest" name="interest" defaultValue="">
          <option value="" disabled>Choose one</option>
          {SERVICES.map((s) => <option key={s.title}>{s.title}</option>)}
          <option>Not sure yet: help me find out</option>
        </select>
      </div>
      <div className="full"><label htmlFor="message">Tell us about the process</label>
        <textarea id="message" name="message" placeholder="e.g. Two people spend most of the day capturing supplier invoices into Sage." /></div>
      <label className="consent full">
        <input type="checkbox" name="consent" value="yes" required />
        <span>I agree that Acolyte may use these details to respond to my enquiry, as explained in the <a href={url("/privacy/")}>privacy notice</a>. We won't add you to a mailing list.</span>
      </label>
      {status === "error" && <div className="msg err full">Sorry, that didn't send. Please try again{SITE.email ? <> or email <a href={`mailto:${SITE.email}`}>{SITE.email}</a></> : null}.</div>}
      <div className="full"><button className="cta" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Request a free assessment"}</button></div>
    </form>
  );
}

const Section = ({ id, eyebrow, title, lede, children, className }: { id?: string; eyebrow: string; title: string; lede?: string; children: ReactNode; className?: string }) => (
  <section id={id} className={className}>
    <div className="inner">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </div>
  </section>
);

export default function Landing() {
  const s = useSnapshot();
  return (
    <div className="lp">
      <nav className="bar">
        <div className="inner">
          <a className="logo" href={url("/")}><img src={url("/favicon.svg")} alt="" />Acolyte</a>
          <div className="links">
            <a href="#services">Services</a>
            <a href="#how">How we work</a>
            <a href={url("/automation-index/")}>Automation Index</a>
            <a href="#calculator">Calculator</a>
            <a className="cta" href="#contact">Free assessment</a>
          </div>
        </div>
      </nav>

      <section className="hero">
        <div className="inner">
          <div>
            <span className="eyebrow">AI & automation implementation partner · South Africa</span>
            <h1>Give your team its <em>time back.</em></h1>
            <p className="lede">
              Acolyte designs and builds AI agents, document automation and finance workflows that take the repetitive
              work off your people, so they can focus on clients, decisions and growth.
            </p>
            <div className="actions">
              <a className="cta" href="#contact">Book a free automation assessment</a>
              <a className="ghost" href={url("/automation-index/")}>See the live SA Automation Index</a>
            </div>
            <div className="trust">
              <span>Works with Sage, Pastel, Xero & Microsoft 365</span>
              <span>WhatsApp-first</span>
              <span>POPIA-aware by design</span>
            </div>
          </div>
          <LiveCard s={s} />
        </div>
      </section>

      <Section id="services" eyebrow="What we automate" title="The work your team shouldn't be doing by hand"
        lede="We start with the processes that eat the most hours and follow the same steps every time.">
        <div className="services">
          {SERVICES.map((sv) => (
            <div className="svc" key={sv.title}>
              <Icon d={sv.icon} />
              <h3>{sv.title}</h3>
              <p>{sv.text}</p>
              <div className="roles"><b>Typical roles: </b>{sv.roles}</div>
            </div>
          ))}
        </div>
      </Section>

      <section className="band">
        <div className="inner">
          <div>
            <span className="eyebrow" style={{ color: "#a5b4fc" }}>Our approach</span>
            <h2>Automation that grows your team's capacity, not your headcount</h2>
            <p>
              Hiring for repetitive work is slow and expensive, and it doesn't scale. We automate the routine parts of a role
              so the people you already have can take on more valuable work.
            </p>
          </div>
          <ul>
            <li><b>Measured in rand</b>Every project starts with what the process costs today and what it will cost after.</li>
            <li><b>People stay in control</b>Automation handles the routine; your team approves exceptions and owns decisions.</li>
            <li><b>Built on what you already use</b>We connect to your accounting, CRM, email and WhatsApp rather than replacing them.</li>
          </ul>
        </div>
      </section>

      <Section id="how" eyebrow="How we work" title="From first conversation to working automation"
        lede="No big-bang IT projects. We prove value on one process before anything else.">
        <div className="steps">
          <div className="step"><h3>Free assessment</h3><p>We map one team's repetitive work, measure the hours, and give you a rand estimate of what automating it is worth.</p></div>
          <div className="step"><h3>Pilot one process</h3><p>We build and run the automation on a single process, with clear before-and-after numbers you can check.</p></div>
          <div className="step"><h3>Scale & support</h3><p>Roll out to the next processes, with monitoring, support and monthly reporting on time and money saved.</p></div>
        </div>
      </Section>

      <Section id="calculator" eyebrow="Calculator" title="What does repetitive work cost you?"
        lede="Move the sliders to match one of your teams.">
        <Calculator />
      </Section>

      <Section eyebrow="Research" title="The SA Automation Opportunity Index"
        lede="We track open job postings across South Africa every day and estimate how much of each role's work could be automated.">
        <div className="teaser">
          <div>
            <ul>
              <li>Which roles companies are hiring for right now, by province</li>
              <li>An automation score for each role, and its value in rand</li>
              <li>Updated automatically every day, with a printable monthly report</li>
            </ul>
            <a className="cta" href={url("/automation-index/")}>Open the live index</a>
          </div>
          <a href={url("/automation-index/")}><img src={url("/img/index-preview.png")} alt="Preview of the SA Automation Opportunity Index dashboard" loading="lazy" /></a>
        </div>
      </Section>

      <Section id="contact" eyebrow="Get started" title="Book a free automation assessment" className="">
        <div className="contact">
          <div>
            <p className="lede" style={{ marginBottom: 0 }}>
              Tell us about one process that takes up too much of your team's time. We'll come back within one business day
              to set up a short call.
            </p>
            <div className="contact-points">
              {SITE.email && <div><b>Email</b><a href={`mailto:${SITE.email}`}>{SITE.email}</a></div>}
              {SITE.phone && <div><b>Phone / WhatsApp</b>{SITE.phone}</div>}
              {SITE.city && <div><b>Based in</b>{SITE.city}, serving clients across South Africa</div>}
            </div>
          </div>
          <ContactForm />
        </div>
      </Section>

      <footer className="site">
        <div className="inner">
          <span>© {new Date().getFullYear()} {SITE.legalName || SITE.name}{SITE.regNumber ? ` · Reg. ${SITE.regNumber}` : ""}</span>
          <span><a href={url("/automation-index/")}>Automation Index</a> · <a href={url("/privacy/")}>Privacy notice</a> · Jobs data by <a href="https://www.adzuna.co.za" target="_blank" rel="noreferrer">Adzuna</a></span>
        </div>
      </footer>
    </div>
  );
}
