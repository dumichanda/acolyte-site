import { url } from "../site";
import type { ReportArtifact } from "../analyst/chart";

/** A published monthly report (web/public/data/reports, written by pipeline/export_reports.py). */
export interface ReportCard {
  id: number; industry: string; analyst: string; period: string; month_to_date: boolean;
  title: string; takeaway: string | null; kpis: { value: string; label: string; context: string; tone: string }[];
  sections: number; published: string | null;
}
export interface ReportFile { id: number; industry: string; analyst: string; period: string; month_to_date: boolean; report: ReportArtifact }

export const ANALYSTS: Record<string, { name: string; ask: string; who: string }> = {
  property: { name: "Property Analyst", ask: "/analyst/?industry=property", who: "Estate agencies, developers, investors" },
  retail: { name: "Retail Pricing Analyst", ask: "/analyst/?industry=retail", who: "FMCG brands and category managers" },
  marketplace: { name: "Marketplace Analyst", ask: "/analyst/?industry=marketplace", who: "Brands and sellers on Amazon.co.za and Takealot" },
  jobs: { name: "Talent Analyst", ask: "/analyst/?industry=jobs", who: "HR, recruitment and workforce planning" },
};

export const monthLabel = (period: string, mtd: boolean) =>
  new Date(period + "T00:00:00").toLocaleDateString("en-ZA", { month: "long", year: "numeric" }) + (mtd ? " · month to date" : "");

export async function loadIndex(): Promise<ReportCard[]> {
  try {
    const r = await fetch(url("/data/reports/index.json"), { cache: "no-cache" });
    return r.ok ? ((await r.json()).reports as ReportCard[]) : [];
  } catch { return []; }
}

export async function loadReport(id: number): Promise<ReportFile | null> {
  try {
    const r = await fetch(url(`/data/reports/${id}.json`));
    return r.ok ? ((await r.json()) as ReportFile) : null;
  } catch { return null; }
}

/** Newest report per analyst, in a fixed analyst order. */
export function latestPerAnalyst(rs: ReportCard[]): ReportCard[] {
  const out: ReportCard[] = [];
  for (const k of Object.keys(ANALYSTS)) {
    const r = rs.filter((x) => x.industry === k).sort((a, b) => b.period.localeCompare(a.period))[0];
    if (r) out.push(r);
  }
  return out;
}
