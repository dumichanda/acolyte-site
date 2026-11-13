import { url } from "./site";

const LINKS = [
  { href: "/automation-index/", label: "Index" },
  { href: "/employers/", label: "Employers" },
  { href: "/tools/", label: "Tools & skills" },
  { href: "/crm/", label: "CRM", private: true },
];

/** Top navigation shared by the platform pages (dashboard, employers, tools, CRM). */
export default function PlatformNav({ active }: { active: string }) {
  return (
    <nav className="pnav">
      <a className="brand" href={url("/")} style={{ textDecoration: "none" }}><div className="brand-mark" />ACOLYTE</a>
      <div className="pnav-links">
        {LINKS.map((l) => (
          <a key={l.href} href={url(l.href)} className={active === l.href ? "on" : ""}>
            {l.label}{l.private && <span className="lock" title="Private: runs on your computer">●</span>}
          </a>
        ))}
      </div>
      <a className="btn cta" href={url("/#contact")}>Talk to Acolyte</a>
    </nav>
  );
}
