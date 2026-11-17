import { useState, type FormEvent } from "react";
import { SITE, url } from "../site";

/**
 * Contact sales: grouped like an enterprise sales form (contact, employment, address, project), every required
 * field marked with *, an optional marketing tick box (POPIA consent), a hidden honeypot against bots.
 * Submissions go to the analyst API (/contact): stored in the private sales schema, shown in the CRM, and the
 * owner gets an alert without personal details.
 */
const ROLES = ["Owner / Founder", "CEO / Managing director", "Director / Executive", "Head of department", "Manager", "Analyst",
  "Sales / Marketing", "Finance", "Operations", "HR / Talent", "IT / Data", "Consultant", "Other"];
const COMPANY_TYPES = ["Estate agency / Property group", "Property developer / Investor", "Retailer", "Online store / Marketplace seller",
  "Brand / Manufacturer / Supplier", "Recruitment agency", "Employer (in-house hiring)", "Consultancy / Agency", "Bank / Financial services",
  "Government / Public sector", "Education / Research", "Other"];
const INDUSTRIES = ["Property / Real estate", "Retail / FMCG", "E-commerce", "Recruitment / HR", "Financial services", "Manufacturing",
  "Logistics", "Hospitality / Tourism", "Healthcare", "Technology", "Media / Marketing", "Other"];
const PROVINCES = ["Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Free State", "Limpopo", "Mpumalanga", "North West",
  "Northern Cape", "Outside South Africa"];
const ANALYSTS: [string, string][] = [["property", "Property Analyst"], ["retail", "Retail Pricing Analyst"], ["marketplace", "Marketplace Analyst"],
  ["jobs", "Talent Analyst"], ["own_data", "An analyst for our own data"], ["not_sure", "Not sure yet"]];
const NATURE: [string, string][] = [["sales", "Sales: plans, demo or pricing"], ["support", "Support: help with the platform"],
  ["billing", "Billing or account"], ["privacy", "Data and privacy (POPIA)"]];

type Status = "idle" | "sending" | "sent" | "error";

const Pick = ({ id, label, items, req = true }: { id: string; label: string; items: (string | [string, string])[]; req?: boolean }) => (
  <div><label htmlFor={id}>{label}{req && " *"}</label>
    <select id={id} name={id} required={req} defaultValue=""><option value="" disabled>Choose an option</option>
      {items.map((x) => Array.isArray(x) ? <option key={x[0]} value={x[0]}>{x[1]}</option> : <option key={x}>{x}</option>)}</select></div>
);
const Text = ({ id, label, req = true, type = "text", auto }: { id: string; label: string; req?: boolean; type?: string; auto?: string }) => (
  <div><label htmlFor={id}>{label}{req && " *"}</label><input id={id} name={id} type={type} required={req} autoComplete={auto} /></div>
);

export default function ContactForm({ preset }: { preset?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [err, setErr] = useState("");
  const [ref, setRef] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim() || null]));
    body.marketing = f.get("marketing") === "yes";
    setStatus("sending"); setErr("");
    try {
      const r = await fetch(`${SITE.analystApi}/contact`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setRef(d.ref || ""); setStatus("sent"); return; }
      setErr(r.status === 422 ? "Please check the highlighted details: phone numbers use digits only, and the email needs an @."
        : typeof d.detail === "string" ? d.detail : "That didn't send.");
      setStatus("error");
    } catch { setErr("That didn't send. Our server may be waking up: please try again in a minute."); setStatus("error"); }
  }

  if (status === "sent") return (
    <div className="cf-card cf-done">
      <h3>Thank you. We've got your message.</h3>
      <p>Someone from Acolyte will reply within one business day.{ref && <> Your reference is <b>{ref}</b>.</>}</p>
      <p><a href={url("/reports/")}>Read this month's free reports →</a></p>
    </div>
  );
  return (
    <form className="f cf-card" onSubmit={submit} noValidate={false}>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ display: "none" }} />
      <p className="cf-req full">An asterisk (*) indicates required information.</p>

      <fieldset className="full"><legend>Contact information</legend>
        <div className="cf-grid">
          <Text id="first_name" label="First name" auto="given-name" />
          <Text id="last_name" label="Last name" auto="family-name" />
          <Text id="phone" label="Business phone number" type="tel" auto="tel" />
          <Text id="email" label="Business email address" type="email" auto="email" />
        </div>
      </fieldset>

      <fieldset className="full"><legend>Employment information</legend>
        <div className="cf-grid">
          <Pick id="job_role" label="Job role" items={ROLES} />
          <Text id="company" label="Company name" auto="organization" />
          <Pick id="company_type" label="Company type" items={COMPANY_TYPES} />
          <Pick id="industry" label="Industry focus" items={INDUSTRIES} />
        </div>
      </fieldset>

      <fieldset className="full"><legend>Address</legend>
        <div className="cf-grid">
          <Pick id="province" label="Province" items={PROVINCES} />
          <Text id="postal_code" label="Work postal code" req={false} auto="postal-code" />
        </div>
      </fieldset>

      <fieldset className="full"><legend>Project details</legend>
        <div className="cf-grid">
          <div><label htmlFor="analyst">Analyst of interest *</label>
            <select id="analyst" name="analyst" required defaultValue={preset || ""}><option value="" disabled>Choose an option</option>
              {ANALYSTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <Pick id="nature" label="Nature of enquiry" items={NATURE} />
          <div className="full"><label htmlFor="message">What would you like to know?</label>
            <textarea id="message" name="message" maxLength={3000} placeholder="e.g. We sell in Gauteng and want to see how our asking prices compare with the market every week." /></div>
        </div>
      </fieldset>

      <label className="consent full"><input type="checkbox" name="marketing" value="yes" />
        <span>Yes, I'd like Acolyte to send me its free monthly report and occasional news about its analysts by email. You can unsubscribe at any time with the link in every email.</span></label>
      <p className="cf-fine full">We use these details to reply to your enquiry, as described in our <a href={url("/privacy/")}>privacy notice</a>. We never sell or share them.</p>
      {status === "error" && <div className="msg err full">{err}{SITE.email ? <> You can also email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.</> : null}</div>}
      <div className="full"><button className="btn-signal" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : <>Submit <span className="arr">→</span></>}</button></div>
    </form>
  );
}
