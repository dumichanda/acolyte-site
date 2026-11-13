-- Metric layer. Every dashboard number comes from these views, so they always agree.
-- CTC factor: salary x 1.25 approximates full cost-to-company (UIF, SDL, leave, equipment, management time).

-- Dropped and recreated each run so new job columns can appear in j.* (dependent views are rebuilt by crm.sql).
DROP VIEW IF EXISTS v_jobs CASCADE;

CREATE VIEW v_jobs AS
SELECT
    j.*,
    c.role_family,
    c.automation_score,
    c.automatable_tasks,
    c.acolyte_service,
    c.method AS classify_method,
    COALESCE(
        CASE WHEN j.salary_min IS NOT NULL AND j.salary_max IS NOT NULL THEN (j.salary_min + j.salary_max) / 2
             ELSE COALESCE(j.salary_min, j.salary_max) END,
        d.annual_salary
    ) AS salary_annual,
    (j.salary_min IS NULL AND j.salary_max IS NULL) AS salary_imputed
FROM jobs j
JOIN classifications c ON c.job_id = j.id
LEFT JOIN family_salary_default d ON d.role_family = c.role_family
-- "Open roles" = posted in the last 60 days. Older postings stay in the table for trend history.
WHERE j.posted_at IS NULL OR j.posted_at >= now() - interval '60 days';

CREATE VIEW v_jobs_value AS
SELECT v.*,
       ROUND(v.salary_annual * 1.25 * v.automation_score / 100.0) AS automatable_value_zar
FROM v_jobs v;
