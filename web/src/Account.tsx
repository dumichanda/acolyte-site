import { useState } from "react";
import { login, type Me } from "./auth";

/** Circular usage ring (percentage left), like Claude's usage meter. */
export function Ring({ pct, label, size = 54 }: { pct: number; label: string; size?: number }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, left = Math.max(0, Math.min(100, pct));
  const color = left > 40 ? "var(--accent)" : left > 15 ? "#ffb86b" : "#ff6a3d";
  return (
    <div className="ring" title={`${Math.round(left)}% of ${label.toLowerCase()} allowance left`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(c * left) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--ink)">{Math.round(left)}%</text>
      </svg>
      <span>{label}</span>
    </div>
  );
}

/** Plan, usage rings and counters for a signed-in account. */
export function UsageCard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const u = me.usage, l = me.limits;
  return (
    <div className="usage-card">
      <div className="who"><b>{me.account.name}</b><span>{me.account.plan_label}</span></div>
      <div className="rings"><Ring pct={me.day_left_pct} label="Today" /><Ring pct={me.week_left_pct} label="This week" /></div>
      <div className="counts">
        <div><b>{u.questions_today}</b>/{l.questions_day} questions today</div>
        <div><b>{u.reports_today}</b>/{l.reports_day} reports today · <b>{u.reports_week}</b>/{l.reports_week} this week</div>
      </div>
      <button className="link" onClick={onLogout}>Sign out</button>
    </div>
  );
}

/** PIN sign-in form. */
export function SignIn({ onDone, compact }: { onDone: (me: Me) => void; compact?: boolean }) {
  const [pin, setPin] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  return (
    <form className={"signin" + (compact ? " compact" : "")} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr("");
      try { onDone(await login(pin.trim())); setPin(""); }
      catch (x) { setErr((x as Error).message || "Couldn't sign in."); }
      finally { setBusy(false); }
    }}>
      {!compact && <p className="muted small">Clients: sign in with your PIN for your plan's allowance, saved chats and live dashboards.</p>}
      <div className="row">
        <input type="password" inputMode="numeric" autoComplete="one-time-code" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="btn primary" disabled={busy || !pin.trim()}>{busy ? "…" : "Sign in"}</button>
      </div>
      {err && <div className="err">{err}</div>}
    </form>
  );
}
