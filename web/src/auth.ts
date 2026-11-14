import { SITE } from "./site";

/** Analyst API base (override with ?api=... once, remembered in this browser). */
export const API = (() => {
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (q) localStorage.setItem("analystApi", q);
    return (q || localStorage.getItem("analystApi") || SITE.analystApi).replace(/\/$/, "");
  } catch { return SITE.analystApi.replace(/\/$/, ""); }
})();

const TOKEN = "acolyteSession";
export const getToken = () => { try { return localStorage.getItem(TOKEN) || ""; } catch { return ""; } };
export const setToken = (t: string) => { try { t ? localStorage.setItem(TOKEN, t) : localStorage.removeItem(TOKEN); } catch { /* storage blocked */ } };

export interface Me {
  account: { id: number; name: string; plan: string; plan_label: string };
  limits: { questions_day: number; reports_day: number; reports_week: number; dashboards: number; max_tier: string };
  usage: { day_usd: number; week_usd: number; questions_today: number; reports_today: number; reports_week: number };
  day_left_pct: number; week_left_pct: number;
}

/** fetch() against the analyst API with the session token; throws Error(detail) on failure. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(API + path, { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && t) setToken("");
  if (!r.ok) throw Object.assign(new Error(data.detail || r.statusText), { status: r.status });
  return data as T;
}

export async function login(pin: string): Promise<Me> {
  const r = await api<{ token: string }>("/auth/login", { body: { pin } });
  setToken(r.token);
  return api<Me>("/me");
}

export const logout = () => setToken("");
