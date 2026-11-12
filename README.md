# Acolyte — website + SA Automation Opportunity Index

| URL | Page |
|---|---|
| `/` | Acolyte landing page: services, ROI calculator, live index teaser, contact form (Formspree) |
| `/automation-index/` | Live dashboard: which SA jobs are being hired for, and how much of that work could be automated |
| `/automation-index/?report` | Printable A4 report |
| `/privacy/` | POPIA privacy notice |

Live at **https://dumichanda.github.io/acolyte-site/** (or your own domain).

```
 GitHub Actions, daily 06:17 SAST
 ┌──────────────────────────────────────────────┐        ┌──────────────────────────┐
 │ Adzuna API ─► fetch ─► Neon Postgres          │ commit │ Deploy workflow builds   │
 │              classify (rules or Claude)      ─┼───────►│ /web ─► GitHub Pages      │
 │              export ─► snapshot.json          │        │ (also on every site push) │
 └──────────────────────────────────────────────┘        └──────────────────────────┘
```

## Deploy (one-time setup, all in the browser)

**1. Make GitHub Pages available.** On a free GitHub account, Pages only works for **public** repos:
Settings → General → Danger Zone → *Change visibility* → Public. (No keys are stored in the code; they live in
Actions secrets. Alternatively, GitHub Pro allows Pages on private repos.)

**2. Turn on Pages.** Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.

**3. Add secrets.** Settings → Secrets and variables → Actions:

| Type | Name | Value |
|---|---|---|
| Secret | `DATABASE_URL` | Neon → your project → Connect → connection string (`...?sslmode=require`) |
| Secret | `ADZUNA_APP_ID` | Adzuna dashboard → Application ID |
| Secret | `ADZUNA_APP_KEY` | Adzuna dashboard → Application Keys |
| Secret | `ANTHROPIC_API_KEY` | Optional, for Claude classification and commentary |
| Variable | `ADZUNA_CALL_BUDGET` | `20` on the test plan; `4500` on API Access |
| Variable | `ADZUNA_BUDGET_PERIOD` | `total` on the test plan; `month` on paid plans |
| Variable | `USE_CLAUDE` | `true` to use Claude on the daily run (optional) |

**4. First run.** Actions → *Refresh Automation Index* → **Run workflow**. It creates the tables in Neon, fetches real jobs,
commits `web/public/data/snapshot.json`, then deploys the site. (The repo ships with sample data, so to publish the site
before the keys are set, run *Deploy site to GitHub Pages* instead.)

**5. Contact form.** Sign up free at formspree.io → New form → copy its endpoint (`https://formspree.io/f/...`) into
`formEndpoint` in `web/src/site.ts`. Enquiries are emailed to you. (Free plan: 50 submissions/month.)

**6. Before launch:** fill in the rest of `web/src/site.ts` (registered name, email, phone, Information Officer).
Own domain: Settings → Pages → Custom domain; the build adjusts its links automatically.

**Adzuna plan:** the test plan has 25 calls in total, and each daily run uses up to 12. Once the budget is used up, the daily run
simply re-publishes the existing data. Upgrade to API Access (£8/month) for fresh data every day.

The website only reads `snapshot.json`, so it is fully static and visitors never touch the database.

## Folder guide

| Path | What it is |
|---|---|
| `db/schema.sql`, `db/views.sql` | Tables and the metric views every number comes from |
| `pipeline/taxonomy.py` | The 15 SA role families, keywords, scores, salaries and Acolyte services. **Edit this to tune the index.** |
| `pipeline/fetch_adzuna.py` | Pulls SA jobs; never exceeds `ADZUNA_CALL_BUDGET` (counts calls in `fetch_log`) |
| `pipeline/seed_demo.py` | Sample data with fictional employers (`is_demo = true`); `--wipe` removes it |
| `pipeline/classify.py` | Keyword rules, or `--claude` for Claude Haiku 5.5 to read each posting |
| `pipeline/export_snapshot.py` | Builds the dashboard JSON + written commentary (`--claude` for Claude Opus 5.5) |
| `refresh.py` | Runs the whole pipeline in one go |
| `web/` | The website: landing (`src/landing`), dashboard (`src/App.tsx`), privacy (`src/privacy`), business details (`src/site.ts`) |
| `web/scripts/make-report.mjs` | Saves the report as PDF into `reports/` |

## Run it on your laptop (Windows)

Needs Python 3.11+ and Node 20+.

```powershell
cd acolyte-index
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then fill in DATABASE_URL and the Adzuna keys
```

**1. Create the tables in Neon**
```powershell
python pipeline\db.py
```

**2. Check the Adzuna plan before spending calls (makes no calls)**
```powershell
python pipeline\fetch_adzuna.py --dry-run
```

**3. Load real jobs, classify, export** (12 calls ≈ 600 jobs on the test plan)
```powershell
python refresh.py
```

**4. Remove the sample data once real data is in**
```powershell
python pipeline\seed_demo.py --wipe
python pipeline\export_snapshot.py
```

**5. Start the dashboard**
```powershell
cd web
npm install
npm run dev
```
Open http://localhost:5173 (landing) or http://localhost:5173/automation-index/ (dashboard; add `?report` for the print version).

**6. Save the PDF report** (first time only: `npx playwright install chromium`)
```powershell
npm run build
npx vite preview          # leave running, then in a second terminal:
npm run report
```

## Notes
- **Adzuna test plan = 25 calls total.** For daily refreshes, upgrade to API Access (£8/month, 5,000 calls), then raise `ADZUNA_CALL_BUDGET`.
- **Adzuna attribution** ("Jobs data by Adzuna") is in the site footer. Keep it when publishing.
- **Automatable value** = salary × 1.25 (cost-to-company) × automation score. When a posting has no salary, the typical salary for the role family is used (marked `*`).
- Scores from the rules classifier are planning estimates. `--claude` scores each posting individually and is more accurate (Haiku 5.5 costs very little at this volume).
