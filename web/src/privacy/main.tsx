import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../landing/landing.css";
import { SITE, url } from "../site";

const who = SITE.legalName || SITE.name;
const contact = SITE.email ? <a href={`mailto:${SITE.email}`}>{SITE.email}</a> : <a href={url("/#contact")}>our contact form</a>;

function Privacy() {
  return (
    <div className="lp">
      <nav className="bar"><div className="inner"><a className="logo" href={url("/")}><img src={url("/favicon.svg")} alt="" />acolyte</a></div></nav>
      <section className="doc">
        <div className="inner" style={{ maxWidth: 760 }}>
          <span className="eyebrow">Privacy notice</span>
          <h2>How we handle your personal information</h2>
          <p className="muted">This notice explains how {who} processes personal information under the Protection of Personal Information Act (POPIA).</p>

          <h3>What we collect</h3>
          <p>When you use our contact form: your name, company, work email, phone number (if given) and your message. The Automation Index uses job postings published by employers via Adzuna; it does not contain information about individual job seekers.</p>

          <h3>Why we use it</h3>
          <p>Only to reply to your enquiry and arrange a conversation you asked for. We rely on your consent, given when you submit the form. We do not add you to a mailing list or sell or share your details for marketing.</p>

          <h3>Who else processes it</h3>
          <p>Our website is hosted on GitHub Pages (GitHub, Inc.) and contact form submissions are delivered by Formspree. Both may store data outside South Africa under appropriate safeguards. We use these service providers only to run the website and receive your enquiry.</p>

          <h3>How long we keep it</h3>
          <p>Enquiries that don't lead to work are deleted within 12 months. If we work together, we keep records for as long as needed for the contract and the law.</p>

          <h3>Your rights</h3>
          <p>You may ask to see, correct or delete your information, withdraw consent, or object to processing at any time by contacting {contact}. You may also lodge a complaint with the Information Regulator (South Africa) at inforeg.org.za.</p>

          {SITE.informationOfficer && (<><h3>Information Officer</h3><p>{SITE.informationOfficer}{SITE.email ? <>, {contact}</> : null}</p></>)}
          <p className="muted" style={{ marginTop: 32 }}>Last updated {new Date(document.lastModified).toLocaleDateString("en-ZA", { month: "long", year: "numeric" })}.</p>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Privacy /></StrictMode>);
