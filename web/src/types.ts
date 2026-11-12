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

export interface Snapshot {
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
