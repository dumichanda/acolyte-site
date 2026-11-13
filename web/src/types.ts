export interface Family {
  family: string; jobs: number; avg_score: number; value: number; avg_salary: number;
  service: string; tasks: string[];
}
export interface Province { province: string; jobs: number; avg_score: number; value: number }
export interface HeatCell { province: string; family: string; jobs: number; avg_score: number }
export interface TrendPoint { day: string; jobs: number; high_jobs: number; value: number }
export interface Job {
  title: string; company: string | null; city: string | null; province: string | null; family: string;
  score: number; value: number; salary_annual: number; salary_imputed: boolean; url: string | null;
  posted: string; service: string;
}
export interface Company { company: string; jobs: number; avg_score: number; value: number; main_family: string }

export interface Snapshot extends SnapshotExtra {
  generated_at: string;
  meta: { jobs: number; has_demo: boolean; all_demo: boolean; from_date: string; to_date: string; claude_classified: number };
  kpis: {
    jobs: number; companies: number; avg_score: number; high_share: number;
    automatable_value: number; median_salary: number; jobs_7d: number;
  };
  by_family: Family[];
  by_province: Province[];
  heatmap: HeatCell[];
  trend: TrendPoint[];
  top_jobs: Job[];
  top_companies: Company[];
  score_dist: { bucket: number; jobs: number }[];
  commentary: { headline: string; bullets: string[]; recommendation: string; source: string };
}

export const rands = (v: number) =>
  v >= 1e9 ? `R${(v / 1e9).toFixed(1)}bn` : v >= 1e6 ? `R${(v / 1e6).toFixed(1)}m` : `R${Math.round(v / 1e3)}k`;

export interface Employer {
  name: string; website: string | null; industry: string | null; size_band: string | null; linkedin_url: string | null;
  description: string | null; lat: number | null; lon: number | null; province: string | null; city: string | null;
  jobs: number; avg_score: number; value: number; main_family: string; pitch: string; families: string[];
  last_posted: string | null; tools: string[] | null; foreign_firm?: boolean; country?: string | null; roles: { title: string; url: string | null; score: number }[] | null;
}
export interface Counted { name: string; jobs: number; avg_score?: number }
export interface Insights {
  jobs_analysed: number; full_text: number;
  tools: Counted[]; skills: Counted[]; qualifications: Counted[]; languages: Counted[];
  tool_by_family: { family: string; tool: string; jobs: number }[];
  work_mode: Counted[]; seniority: Counted[];
  experience: { family: string; avg_years: number; jobs: number }[];
}
export interface HistoryPoint { day: string; jobs: number; employers: number; recruiter_jobs: number; avg_score: number; automatable_value: number }
/** Sections added with the employer/tools/CRM release; optional so older snapshots still load. */
export interface SnapshotExtra {
  employers?: Employer[];
  posters?: { kind: string; jobs: number }[];
  insights?: Insights;
  history?: HistoryPoint[];
}
