"""One command to refresh everything: fetch -> classify -> export.

    python refresh.py                 # live Adzuna data, rules classifier
    python refresh.py --claude        # use Claude for classification + commentary
    python refresh.py --demo          # no Adzuna: (re)seed sample data instead
    python refresh.py --max-calls 5   # cap Adzuna calls this run
    python refresh.py --no-web        # skip the Claude web job search
"""
import argparse
import subprocess
import sys
from pathlib import Path

P = Path(__file__).resolve().parent / "pipeline"


def run(script: str, *args: str) -> None:
    print(f"\n== {script} {' '.join(args)}")
    subprocess.run([sys.executable, str(P / script), *args], check=True, cwd=P)


ap = argparse.ArgumentParser()
ap.add_argument("--claude", action="store_true")
ap.add_argument("--demo", action="store_true")
ap.add_argument("--max-calls", default=None)
ap.add_argument("--no-web", action="store_true", help="skip the Claude web job search")
a = ap.parse_args()

if a.demo:
    run("seed_demo.py")
else:
    run("fetch_adzuna.py", *(["--max-calls", a.max_calls] if a.max_calls else []))
    if not a.no_web:
        run("claude_jobs.py")  # skips itself when ANTHROPIC_API_KEY is not set
run("classify.py", *(["--claude"] if a.claude else []))
run("export_snapshot.py", *(["--claude"] if a.claude else []))
print("\nDone.")
