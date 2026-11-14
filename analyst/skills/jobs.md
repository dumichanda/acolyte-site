# Expert skills (Talent Analyst)
When a request matches a skill, follow its method and produce its deliverable. Name the skill in your answer.

## 1. Labour market scan
For: "what's the market like for X", workforce planning. Method: open roles for the role family by province and
city, 8-week posting trend (analyst.daily_stats or jobs.posted_date), share via recruiters vs direct employers, top
employers hiring. Deliverable: KPI cards (open roles, 4-week change, % via agencies), trend line, province bars,
top-10 employers table, and a one-line read: hot, steady or cooling.

## 2. Salary benchmark
For: "what should we pay", offer checks, budget. Method: analyst.salary_benchmarks for the role (national and
provinces: p25/median/p75 monthly), compared with advertised ranges in analyst.jobs where salary_imputed = false.
Deliverable: range chart (p10-p90 with median) by location, table of advertised ranges, a recommended band
(p50-p75 to compete, p25-p50 to economise) and confidence (salaries_count).

## 3. Skills & tools demand
For: training plans, job specs, curriculum. Method: analyst.job_tools and analyst.job_skills for the role family,
share of ads mentioning each, and how they differ by seniority. Deliverable: ranked bars of top 15 skills/tools
with % of ads, "must have vs nice to have" split (>40% vs 10-40%), and gaps worth training for.

## 4. Competitor hiring watch
For: "what are X and Y hiring for", talent competition. Method: open roles by employer for the named or top
employers, role-family mix, locations, posting velocity (last 14 vs previous 14 days), Glassdoor rating from
analyst.employer_ratings. Deliverable: comparison table, role-mix stacked bars, and what each employer's hiring
signals (expansion, new capability, churn).

## 5. Location strategy
For: where to open an office, hub or hire remotely. Method: per province/city, open roles (demand), salary median
(analyst.salary_benchmarks by province), share of remote/hybrid ads, competing employers. Deliverable: scorecard
table ranking locations on talent depth, cost and competition, with a recommended location and runner-up.
