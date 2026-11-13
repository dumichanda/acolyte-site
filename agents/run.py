"""Run an agent from the command line or the daily pipeline.

    python -m agents.run job_scout --roles 3 --target 6
    python -m agents.run company_researcher --companies 8
    python -m agents.run job_scout --role "payroll administrator" --model google/gemini-2.5-flash

Model: --model, else AGENT_MODEL, else Claude Opus 5.5 (ANTHROPIC_API_KEY), else a tool-capable OpenRouter model.
Budget: --max-cost in USD per run (default AGENT_MAX_COST or 0.40). Every step is logged in agent_runs / agent_steps.
"""
import argparse
import os
import sys

import harness  # noqa: F401  (puts pipeline/ on the path)
from harness.providers import default_model

from db import connect, init_db


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("agent", choices=["job_scout", "company_researcher"])
    ap.add_argument("--model")
    ap.add_argument("--max-cost", type=float, default=float(os.environ.get("AGENT_MAX_COST", "0.40")))
    ap.add_argument("--roles", type=int, default=int(os.environ.get("SCOUT_ROLES_PER_RUN", "3")))
    ap.add_argument("--role", action="append")
    ap.add_argument("--target", type=int, default=6)
    ap.add_argument("--companies", type=int, default=int(os.environ.get("RESEARCH_PER_RUN", "8")))
    a = ap.parse_args()

    model = a.model or default_model()
    if not model:
        print("No agent model available (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY, or AGENT_MODEL). Skipping.")
        return 0
    init_db()
    with connect() as conn:
        if a.agent == "job_scout":
            from agents.job_scout import build, roles_for_today
            agent, task = build(model, a.role or roles_for_today(a.roles), target=a.target, max_cost=a.max_cost)
        else:
            from agents.company_researcher import build, pick_companies
            companies = pick_companies(conn, a.companies)
            if not companies:
                print("No companies need research.")
                return 0
            agent, task = build(model, companies, max_cost=a.max_cost)
        print(f"Agent {a.agent} on {model} (budget ${a.max_cost:.2f})")
        res = agent.run(task, conn=conn)
    print(f"Result: {res.status} · {res.tool_calls} tool calls · ${res.cost_usd:.4f} · {res.stats}\n{res.summary[:1500]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
