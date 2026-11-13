-- The analyst's "semantic layer": the only data the AI analyst can see.
-- Clean, documented views in their own schema. CRM tables (contacts, opportunities, activities,
-- suppression) are deliberately NOT exposed. The analyst connects as a read-only role that can
-- read this schema and nothing else (see pipeline/db.py: setup_analyst_role).
CREATE SCHEMA IF NOT EXISTS analyst;

DROP VIEW IF EXISTS analyst.jobs, analyst.job_tools, analyst.job_skills, analyst.employers, analyst.daily_stats CASCADE;

CREATE VIEW analyst.jobs AS
SELECT v.id                                   AS job_id,
       v.title,
       COALESCE(c.name, v.company)            AS employer,
       CASE WHEN c.id IS NULL THEN 'not named' WHEN c.is_recruiter THEN 'recruitment agency'
            ELSE 'direct employer' END        AS poster_type,
       v.province, v.city,
       v.role_family,
       v.automation_score,
       (v.automation_score >= 60)             AS high_potential,
       v.salary_annual,
       v.salary_imputed,
       v.automatable_value_zar,
       v.posted_at::date                      AS posted_date,
       v.contract_type, v.contract_time,
       i.seniority, i.work_mode, i.experience_years,
       left(COALESCE(v.full_description, v.description), 600) AS description,
       v.url,
       v.source
FROM v_jobs_value v
LEFT JOIN companies c   ON c.id = v.company_id
LEFT JOIN job_insights i ON i.job_id = v.id
WHERE NOT v.is_demo;

CREATE VIEW analyst.job_tools AS
SELECT i.job_id, t AS tool FROM job_insights i, unnest(i.tools) t
WHERE i.job_id IN (SELECT job_id FROM analyst.jobs);

CREATE VIEW analyst.job_skills AS
SELECT i.job_id, s AS skill FROM job_insights i, unnest(i.skills) s
WHERE i.job_id IN (SELECT job_id FROM analyst.jobs);

CREATE VIEW analyst.employers AS
SELECT l.name AS employer, l.is_recruiter, l.website, l.industry, l.size_band,
       COALESCE(l.hq_province, (SELECT province FROM jobs j WHERE j.company_id = l.id AND province IS NOT NULL
                                GROUP BY 1 ORDER BY count(*) DESC LIMIT 1)) AS province,
       l.open_roles, l.avg_score, l.automatable_value AS automatable_value_zar, l.main_family, l.last_posted::date AS last_posted
FROM v_company_leads l;

CREATE VIEW analyst.daily_stats AS
SELECT day, jobs, employers, recruiter_jobs, avg_score, automatable_value AS automatable_value_zar FROM daily_stats;
