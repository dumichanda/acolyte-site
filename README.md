# Acolyte — SA Automation Opportunity Index

Live public dashboard: which jobs South Africa is hiring for, and how much of that work AI and automation could do.

```
Adzuna API ─► fetch_adzuna.py ─► Postgres (Neon) ─► classify.py (rules or Claude)
                                       │
                                       └─► export_snapshot.py ─► web/public/data/snapshot.json
                                                                    │
                                    React + ECharts site (Vite) ◄───┘ ──► ?report ─► PDF (Playwright)
```

The website only reads `snapshot.json`, so it can be hosted for free (Cloudflare Pages / Vercel / Netlify) and visitors never touch the database.

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
| `web/` | The dashboard site; `?report` is the A4 print layout |
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
Open http://localhost:5173. Add `?report` to the URL for the printable version.

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
