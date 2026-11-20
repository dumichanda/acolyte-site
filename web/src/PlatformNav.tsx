import { url } from "./site";

/** The site's one menu (the landing page uses the same links in its floating pill). CRM shows only to you and your agents. */
export const NAV = [
  { href: "/analyst/", label: "Ask AI" },
  { href: "/dashboards/", label: "Dashboards" },
  { href: "/reports/", label: "Reports" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/#automation", label: "Automation" },
];

/** True on a browser where the owner or an account agent has signed in to the CRM or Admin page. */
export const isStaff = () => {
  try { return !!(localStorage.getItem("acolyteAdminKey") || localStorage.getItem("acolyteAgentToken")); } catch { return false; }
};

/** Top navigation shared by the platform pages (Ask AI, dashboards, reports, CRM, ...). */
export default function PlatformNav({ active }: { active: string }) {
  const links = isStaff() ? [...NAV, { href: "/crm/", label: "CRM" }] : NAV;
  return (
    <nav className="pnav">
      <a className="brand" href={url("/")} style={{ textDecoration: "none" }}><div className="brand-mark" />ACOLYTE</a>
      <div className="pnav-links">
        {links.map((l) => <a key={l.href} href={url(l.href)} className={active === l.href ? "on" : ""}>{l.label}</a>)}
      </div>
      <a className="btn cta" href={url("/contact/")}>Book a session</a>
    </nav>
  );
}
