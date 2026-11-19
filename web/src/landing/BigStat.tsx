import { url } from "../site";

/**
 * Closing band before the contact form: a glowing lime card with a receding grid and one big claim about the analyst
 * (always on), with small glass cards for what it does. About the analyst, not about our data.
 */
export default function BigStat() {
  return (
    <section className="bigstat" aria-label="Your AI data analyst, always on">
      <div className="inner">
        <span className="pill-tag"><i />Always on</span>
        <div className="bs-card">
          <div className="bs-grid" aria-hidden="true"><i className="floor" /><i className="ceil" /><i className="wall l" /><i className="wall r" /></div>
          <span className="bs-badge">Your AI data analyst</span>

          <div className="bs-float tl" aria-hidden="true">
            <div className="bs-fh"><b>Daily brief</b><span>07:00</span></div>
            <div className="bs-lines"><i style={{ width: "72%" }} /><i style={{ width: "48%" }} /></div>
            <div className="bs-lines"><i style={{ width: "38%" }} /><i style={{ width: "64%" }} /></div>
            <span className="bs-chip dark">Before your first meeting</span>
          </div>

          <div className="bs-float tr" aria-hidden="true">
            <div className="bs-fh"><b>Live dashboards</b><span>Every day</span></div>
            <div className="bs-bar"><i style={{ width: "86%" }} /></div>
            <p>Every chart refreshes itself</p>
            <span className="bs-chip light">Your data, read-only</span>
          </div>

          <div className="bs-number" aria-hidden="true">24/7</div>
          <div className="bs-sub" aria-hidden="true">Never sleeps.</div>

          <div className="bs-float br" aria-hidden="true">
            <span className="bs-chip lime">Ask in plain English</span>
            <small>Answers in</small>
            <b className="bs-mini">Seconds</b>
            <p>+ the chart, dashboard or pack</p>
          </div>

          <div className="bs-cta">
            <a className="btn-signal" href="#contact">Book a free data session <span className="arr">→</span></a>
          </div>
        </div>
        <p className="bs-note">Ask it anything about your business, at any hour. It answers from your own data, shows its working, and hands over the chart,
          dashboard or report pack. <a href={url("/analyst/")}>Try it now</a>.</p>
      </div>
    </section>
  );
}
