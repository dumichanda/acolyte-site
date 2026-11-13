"""One command to refresh everything: fetch -> companies -> insights -> enrich -> classify -> export.

    python refresh.py                 # live data, rules classifier
    python refresh.py --claude        # use Claude for classification, commentary and email drafts
    python refresh.py --demo          # no Adzuna: (re)seed sample data instead
    python refresh.py --max-calls 5   # cap Adzuna calls this run
    python refresh.py --no-web        # skip the Gemini/Claude web job search
    python refresh.py --no-enrich     # skip company/website enrichment and full-text lookups
"""
import argparse
import subprocess
import sys
from pathlib import Path

P = Path(__file__).resolve().parent / "pipeline"


def run(script: str, *args: str, optional: bool = False) -> None:
    print(f"\n== {script} {' '.join(args)}", flush=True)
    r = subprocess.run([sys.executable, str(P / script), *args], cwd=P)
    if r.returncode and not optional:
        sys.exit(r.returncode)
    if r.returncode:
        print(f"(optional step {script} failed; continuing)")


def agent(name: str) -> None:
    print(f"\n== agent {name}", flush=True)
    r = subprocess.run([sys.executable, "-m", "agents.run", name], cwd=P.parent)
    if r.returncode:
        print(f"(agent {name} failed; continuing)")


ap = argparse.ArgumentParser()
ap.add_argument("--claude", action="store_true")
ap.add_argument("--demo", action="store_true")
ap.add_argument("--max-calls", default=None)
ap.add_argument("--no-web", action="store_true", help="skip the Gemini/Claude web job search")
ap.add_argument("--no-enrich", action="store_true", help="skip web enrichment (websites, contacts, full ad text)")
a = ap.parse_args()
claude = ["--claude"] if a.claude else []

if a.demo:
    run("seed_demo.py")
else:
    run("fetch_adzuna.py", *(["--max-calls", a.max_calls] if a.max_calls else []))
    if not a.no_web:
        agent("job_scout")  # agentic web job search (OpenRouter or Claude); skips itself without a key
run("classify.py", *claude)
run("companies.py")
if not a.demo and not a.no_enrich:
    agent("company_researcher")  # agentic company profiles; skips itself without a key
    run("enrich_companies.py", optional=True)
    run("full_descriptions.py", optional=True)
run("insights.py")
if not a.demo:
    run("draft_outreach.py", *claude, optional=True)
run("export_snapshot.py", *claude)
print("\nDone.")
