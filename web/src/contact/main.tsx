import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import "../landing/landing.css";
import { SITE, url } from "../site";
import ContactForm from "./ContactForm";

const preset = new URLSearchParams(location.search).get("analyst") || undefined;

function Contact() {
  return (
    <div className="lp">
      <nav className="bar"><div className="inner"><a className="logo" href={url("/")}><img src={url("/favicon.svg")} alt="" />acolyte</a></div></nav>
      <section className="cf-page">
        <div className="inner contact">
          <div>
            <span className="eyebrow">Contact sales</span>
            <h1>Tell us what you want to <em>know.</em></h1>
            <p className="lede">Tell us about your business and the questions you can't answer today. Someone from Acolyte will reach out to show how an analyst can help you and your team.</p>
            <p className="muted">For help with the platform, billing or your data, choose the matching option under <b>Nature of enquiry</b>.</p>
            <ol className="cf-steps">
              <li><span><b>We reply within one business day</b>by email or phone, whichever you prefer.</span></li>
              <li><span><b>A free 30-minute data session</b>we answer one of your real questions live, on South African data.</span></li>
              <li><span><b>A plan that fits</b>one analyst or several, monthly, cancel any time.</span></li>
            </ol>
            <div className="contact-points">
              {SITE.email && <div><b>Email</b><a href={`mailto:${SITE.email}`}>{SITE.email}</a></div>}
              {SITE.phone && <div><b>Phone / WhatsApp</b>{SITE.phone}</div>}
            </div>
          </div>
          <ContactForm preset={preset} />
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Contact /></StrictMode>);
