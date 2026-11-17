import type { Snapshot } from "../types";
import { url } from "../site";

/**
 * The "big number" band: one live figure from Acolyte's market data, huge, in a glowing lime card with a receding grid,
 * and small glass cards around it showing what the analyst does with it. The number is real (read from snapshot.json);
 * it hides itself until the data has loaded rather than showing a made-up figure.
 */
type Prop = { for_sale?: number; to_rent?: number; regions?: number; day?: string };

export default function BigStat({ s }: { s: Snapshot | null }) {
  const p = (s as unknown as { property?: Prop } | null)?.property;
  const total = (p?.for_sale ?? 0) + (p?.to_rent ?? 0);
  if (!total) return null;
  const big = total >= 1000 ? `${Math.floor(total / 1000)}K` : String(total);
  const day = p?.day ? new Date(p.day).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";
  return (
    <section className="bigstat" aria-label={`${total.toLocaleString("en-ZA")} property listings read every morning`}>
      <div className="inner">
        <span className="pill-tag"><i />Live market</span>
        <div className="bs-card">
          <div className="bs-grid" aria-hidden="true"><i className="floor" /><i className="ceil" /><i className="wall l" /><i className="wall r" /></div>
          <span className="bs-badge">Demonstration data</span>

          <div className="bs-float tl" aria-hidden="true">
            <div className="bs-fh"><b>Daily brief</b><span>07:00</span></div>
            <div className="bs-lines"><i style={{ width: "72%" }} /><i style={{ width: "48%" }} /></div>
            <div className="bs-lines"><i style={{ width: "38%" }} /><i style={{ width: "64%" }} /></div>
            <span className="bs-chip dark">Before the sales meeting</span>
          </div>

          <div className="bs-float tr" aria-hidden="true">
            <div className="bs-fh"><b>Live dashboards</b><span>{day ? `Updated ${day}` : "Daily"}</span></div>
            <div className="bs-bar"><i style={{ width: "86%" }} /></div>
            <p>Every chart refreshes itself</p>
            <span className="bs-chip light">Your data, read-only</span>
          </div>

          <div className="bs-number" aria-hidden="true">{big}</div>
          <div className="bs-sub" aria-hidden="true">Listings read every morning</div>

          <div className="bs-float br" aria-hidden="true">
            <span className="bs-chip lime">Ask in plain English</span>
            <small>Answers in</small>
            <b className="bs-mini">Seconds</b>
            <p>+ the chart, dashboard or pack</p>
          </div>

          <div className="bs-cta">
            <a className="btn-signal" href={url("/property/")}>See the Property Analyst <span className="arr">→</span></a>
          </div>
        </div>
        <p className="bs-note">{total.toLocaleString("en-ZA")} homes for sale and to rent across {p?.regions ?? "all"} regions on Private Property,
          counted{day ? ` on ${day}` : " daily"}. Shown as a demonstration; your analyst works on your own data.</p>
      </div>
    </section>
  );
}
