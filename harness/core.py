"""Acolyte agent harness: a small, model-agnostic agent loop with guardrails.

    agent = Agent(name="job_scout", model="google/gemini-...", system=..., tools=[...], max_cost_usd=0.50)
    result = agent.run("Find ...", conn=db_connection)

What the harness guarantees, whatever the model:
  - Budgets: max model turns, max total cost (USD), max calls per tool. The run stops cleanly when one is hit.
  - Tool inputs are checked against the tool's schema (required fields, basic types) before the tool runs;
    bad calls go back to the model as errors instead of crashing the run.
  - Tool outputs are truncated so one big page can't flood the context.
  - Every model turn and tool call is written to agent_runs / agent_steps (when a DB connection is given),
    so you can audit what an agent did and what it cost.
  - Tools that change data ("writes") are the only way an agent affects anything, and each one does its own
    verification (e.g. a job is saved only if its page was actually fetched and names the job).
"""
import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .providers import ProviderError, Turn, adapter

MAX_TOOL_OUTPUT = 6000
TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict}


@dataclass
class Tool:
    name: str
    description: str
    schema: dict
    fn: Callable[..., Any]          # fn(ctx, **args) -> str | dict | list
    max_calls: int = 50
    writes: bool = False            # changes data (logged as such)

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description, "schema": self.schema}


@dataclass
class RunResult:
    status: str
    summary: str
    steps: int
    tool_calls: int
    cost_usd: float
    run_id: int | None
    stats: dict = field(default_factory=dict)


def check_args(schema: dict, args: dict | None) -> str | None:
    """Light JSON-schema check: object, required keys, top-level types, enums."""
    if not isinstance(args, dict):
        return "arguments must be a JSON object"
    props = schema.get("properties", {})
    for k in schema.get("required", []):
        if k not in args:
            return f"missing required field '{k}'"
    for k, v in args.items():
        p = props.get(k)
        if p is None:
            if schema.get("additionalProperties") is False:
                return f"unknown field '{k}'"
            continue
        t = TYPES.get(p.get("type"))
        if t and v is not None and not isinstance(v, t) or (p.get("type") == "integer" and isinstance(v, bool)):
            return f"field '{k}' must be {p.get('type')}"
        if "enum" in p and v not in p["enum"]:
            return f"field '{k}' must be one of {p['enum']}"
    return None


class Agent:
    def __init__(self, name: str, model: str, system: str, tools: list[Tool], *, max_steps: int = 25,
                 max_cost_usd: float = 0.50, on_event: Callable[[str], None] | None = print, provider=None, ctx=None):
        self.name, self.model, self.system, self.tools = name, model, system, {t.name: t for t in tools}
        self.max_steps, self.max_cost = max_steps, max_cost_usd
        self.on_event = on_event or (lambda s: None)
        self.provider = provider or adapter(model)
        self.ctx = ctx if ctx is not None else {}

    # --------------------------------------------------------------- audit log
    def _log_start(self, conn, task):
        if conn is None:
            return None
        rid = conn.execute("INSERT INTO agent_runs (agent, model, task) VALUES (%s, %s, %s) RETURNING id",
                           (self.name, self.model, task[:4000])).fetchone()[0]
        conn.commit()
        return rid

    def _log_step(self, conn, rid, n, kind, name, inp, out, err=False, cost=None):
        if conn is None or rid is None:
            return
        conn.execute("""INSERT INTO agent_steps (run_id, n, kind, name, input, output, is_error, cost_usd)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                     (rid, n, kind, name, json.dumps(inp, default=str)[:8000] if inp is not None else None,
                      (out or "")[:4000], err, cost))
        conn.commit()

    def _log_end(self, conn, rid, res: RunResult, error=None):
        if conn is None or rid is None:
            return
        conn.execute("""UPDATE agent_runs SET status=%s, steps=%s, tool_calls=%s, cost_usd=%s, summary=%s, error=%s,
                        finished_at=now() WHERE id=%s""",
                     (res.status, res.steps, res.tool_calls, res.cost_usd, res.summary[:4000], error, rid))
        conn.commit()

    # --------------------------------------------------------------- loop
    def run(self, task: str, conn=None) -> RunResult:
        rid = self._log_start(conn, task)
        self.ctx.setdefault("stats", {})
        self.ctx["conn"], self.ctx["run_id"] = conn, rid
        messages = self.provider.start(task)
        specs = [t.spec() for t in self.tools.values()]
        used: dict[str, int] = {}
        cost, n_calls, text, status, error = 0.0, 0, "", "max_steps", None
        step = 0
        try:
            for step in range(1, self.max_steps + 1):
                if cost >= self.max_cost:
                    status = "budget"
                    break
                t0 = time.time()
                turn: Turn = self.provider.step(self.system, messages, specs)
                cost += turn.cost
                text = turn.text or text
                self._log_step(conn, rid, step, "model", self.model, None,
                               (turn.text or "")[:2000] + (f" [{len(turn.calls)} tool calls]" if turn.calls else ""),
                               cost=turn.cost)
                self.on_event(f"[{self.name}] turn {step}: {len(turn.calls)} tool call(s), ${cost:.4f}, {time.time() - t0:.1f}s")
                if turn.stop == "refusal":
                    status = "error"
                    error = "model refused"
                    break
                if turn.stop == "pause":
                    continue
                if not turn.calls:
                    status = "done"
                    break
                results = []
                for c in turn.calls:
                    n_calls += 1
                    tool = self.tools.get(c.name)
                    if tool is None:
                        out, err = f"Unknown tool '{c.name}'. Available: {', '.join(self.tools)}", True
                    elif used.get(c.name, 0) >= tool.max_calls:
                        out, err = f"Limit reached for {c.name} ({tool.max_calls} calls). Finish with what you have.", True
                    elif (msg := check_args(tool.schema, c.args)) is not None:
                        out, err = f"Invalid arguments for {c.name}: {msg}. Raw: {c.raw[:300]}", True
                    else:
                        used[c.name] = used.get(c.name, 0) + 1
                        try:
                            res = tool.fn(self.ctx, **c.args)
                            out = res if isinstance(res, str) else json.dumps(res, default=str, ensure_ascii=False)
                            err = False
                        except Exception as e:  # tool failures go back to the model, they don't end the run
                            out, err = f"{e.__class__.__name__}: {e}", True
                    extra = self.ctx.pop("extra_cost", 0.0)   # tools that pay for things (e.g. web search) report it
                    cost += extra
                    if len(out) > MAX_TOOL_OUTPUT:
                        out = out[:MAX_TOOL_OUTPUT] + f"\n…[truncated {len(out) - MAX_TOOL_OUTPUT} chars]"
                    self._log_step(conn, rid, step, "tool", c.name, c.args, out, err, cost=extra or None)
                    arg = next(iter((c.args or {}).values()), "") if isinstance(c.args, dict) else ""
                    self.on_event(f"    {'✗' if err else '·'} {c.name}({str(arg)[:70]}) -> {out[:110].replace(chr(10), ' ')}")
                    results.append((c.id, out, err))
                self.provider.add_results(messages, results)
                if turn.stop == "length":
                    status, error = "error", "output truncated"
                    break
        except ProviderError as e:
            status, error = "error", str(e)
            self.on_event(f"[{self.name}] provider error: {e}")
        res = RunResult(status=status, summary=text.strip(), steps=step, tool_calls=n_calls, cost_usd=round(cost, 5),
                        run_id=rid, stats=dict(self.ctx["stats"]))
        self._log_end(conn, rid, res, error)
        self.on_event(f"[{self.name}] {status}: {n_calls} tool calls, ${cost:.4f}. {res.stats}")
        return res
