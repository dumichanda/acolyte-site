"""Model providers for the agent harness. Each adapter keeps the conversation in its own native format.

  claude-*            -> Anthropic API directly (ANTHROPIC_API_KEY): prompt caching + server-side fallbacks
  anything else       -> OpenRouter (OPENROUTER_API_KEY), e.g. "google/gemini-...", "deepseek/...", "qwen/..."
                         or "anthropic/claude-..." if you prefer to pay for Claude through OpenRouter.
"""
import json
import os
from dataclasses import dataclass, field

import requests

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
SITE = "https://dumichanda.github.io/acolyte-site/"

# USD per 1M tokens (input, output) for direct Anthropic calls; OpenRouter reports cost itself.
ANTHROPIC_PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50),
                    "claude-fable-5-2": (8.0, 40.0)}
FALLBACK_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5")


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict | None          # None when the model sent arguments that are not valid JSON
    raw: str = ""


@dataclass
class Turn:
    text: str
    calls: list[ToolCall] = field(default_factory=list)
    cost: float = 0.0
    stop: str = ""             # end | tool_use | refusal | length | error
    citations: list[dict] = field(default_factory=list)   # [{url, title, content}] from web search plugins


class ProviderError(Exception):
    pass


def provider_for(model: str) -> str:
    return "anthropic" if model.startswith("claude-") else "openrouter"


# ----------------------------------------------------------------------------------------- Anthropic
class AnthropicAdapter:
    def __init__(self, model: str, effort: str = "medium", client=None):
        import anthropic
        self.model, self.effort = model, effort
        self.client = client or anthropic.Anthropic()

    def tools(self, specs):
        return [{"name": t["name"], "description": t["description"], "input_schema": t["schema"]} for t in specs]

    def start(self, task: str) -> list:
        return [{"role": "user", "content": task}]

    def step(self, system: str, messages: list, tools: list) -> Turn:
        import anthropic
        extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"} if self.model in FALLBACK_MODELS else {}
        try:
            r = self.client.beta.messages.create(
                model=self.model, max_tokens=16000,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                tools=self.tools(tools), messages=messages,
                output_config={"effort": self.effort}, **extra,
            )
        except anthropic.APIError as e:
            raise ProviderError(f"{e.__class__.__name__}: {e}") from e
        messages.append({"role": "assistant", "content": r.content})
        u = r.usage
        pin, pout = ANTHROPIC_PRICES.get(self.model, (4.0, 20.0))
        g = lambda k: getattr(u, k, 0) or 0  # noqa: E731
        cost = ((g("input_tokens") + 1.25 * g("cache_creation_input_tokens") + 0.1 * g("cache_read_input_tokens")) * pin
                + g("output_tokens") * pout) / 1e6
        calls = [ToolCall(b.id, b.name, b.input if isinstance(b.input, dict) else None) for b in r.content if b.type == "tool_use"]
        text = "".join(b.text for b in r.content if b.type == "text")
        stop = {"end_turn": "end", "tool_use": "tool_use", "refusal": "refusal", "max_tokens": "length",
                "pause_turn": "pause"}.get(r.stop_reason, r.stop_reason or "end")
        return Turn(text=text, calls=calls, cost=cost, stop=stop)

    def add_results(self, messages: list, results: list[tuple[str, str, bool]]) -> None:
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": i, "content": out, **({"is_error": True} if err else {})}
            for i, out, err in results]})


# ----------------------------------------------------------------------------------------- OpenRouter
class OpenRouterAdapter:
    """OpenAI-compatible chat completions on OpenRouter, with function calling."""

    def __init__(self, model: str, key: str | None = None, session: requests.Session | None = None, plugins=None):
        self.model = model
        self.key = key or os.environ.get("OPENROUTER_API_KEY", "")
        self.http = session or requests.Session()
        self.plugins = plugins
        if not self.key:
            raise ProviderError("OPENROUTER_API_KEY is not set")

    def tools(self, specs):
        return [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["schema"]}}
                for t in specs]

    def start(self, task: str) -> list:
        return [{"role": "user", "content": task}]

    def post(self, body: dict) -> dict:
        try:
            r = self.http.post(OPENROUTER_URL, json=body, timeout=180, headers={
                "Authorization": f"Bearer {self.key}", "HTTP-Referer": SITE, "X-Title": "Acolyte agents"})
        except requests.RequestException as e:
            raise ProviderError(f"network: {e}") from e
        try:
            data = r.json()
        except ValueError:
            raise ProviderError(f"HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code != 200 or "error" in data:
            err = data.get("error") or {}
            raise ProviderError(f"HTTP {r.status_code}: {err.get('message') if isinstance(err, dict) else err}")
        return data

    def step(self, system: str, messages: list, tools: list) -> Turn:
        body = {"model": self.model, "messages": [{"role": "system", "content": system}, *messages],
                "usage": {"include": True}, "max_tokens": 8000}
        if tools:
            body["tools"], body["tool_choice"] = self.tools(tools), "auto"
        if self.plugins:
            body["plugins"] = self.plugins
        data = self.post(body)
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        messages.append({k: v for k, v in msg.items() if k in ("role", "content", "tool_calls")} | {"role": "assistant"})
        calls = []
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function") or {}
            raw = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
                args = args if isinstance(args, dict) else None
            except json.JSONDecodeError:
                args = None
            calls.append(ToolCall(tc.get("id") or f"call_{len(calls)}", fn.get("name", ""), args, raw if isinstance(raw, str) else ""))
        cites = [{"url": a["url_citation"].get("url"), "title": a["url_citation"].get("title", ""),
                  "content": a["url_citation"].get("content", "")}
                 for a in msg.get("annotations") or [] if a.get("type") == "url_citation" and a.get("url_citation")]
        fr = choice.get("finish_reason") or ""
        stop = "tool_use" if calls else {"stop": "end", "length": "length", "content_filter": "refusal"}.get(fr, "end")
        return Turn(text=msg.get("content") or "", calls=calls, cost=float((data.get("usage") or {}).get("cost") or 0),
                    stop=stop, citations=cites)

    def add_results(self, messages: list, results: list[tuple[str, str, bool]]) -> None:
        for i, out, err in results:
            messages.append({"role": "tool", "tool_call_id": i, "content": ("ERROR: " if err else "") + out})


def adapter(model: str, **kw):
    return AnthropicAdapter(model, **kw) if provider_for(model) == "anthropic" else OpenRouterAdapter(model, **kw)


def default_model() -> str | None:
    """AGENT_MODEL if set; else Claude Opus 5.5 direct (ANTHROPIC_API_KEY); else a tool-capable OpenRouter model:
    the newest Gemini Flash it lists, else the cheapest model that supports tools."""
    if os.environ.get("AGENT_MODEL"):
        return os.environ["AGENT_MODEL"]
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "claude-opus-5-5"
    if not os.environ.get("OPENROUTER_API_KEY"):
        return None
    try:
        models = requests.get("https://openrouter.ai/api/v1/models", timeout=20).json().get("data", [])
    except (requests.RequestException, ValueError):
        return None
    import re
    usable = [m for m in models if "tools" in (m.get("supported_parameters") or []) and not m["id"].endswith(":free")]
    flash = [m["id"] for m in usable if re.match(r"google/gemini-[\d.]+-flash$", m["id"])]
    if flash:
        return max(flash, key=lambda i: float(re.findall(r"[\d.]+", i)[0]))
    price = lambda m: float((m.get("pricing") or {}).get("prompt") or 1) + float((m.get("pricing") or {}).get("completion") or 1)  # noqa: E731
    usable = [m for m in usable if price(m) > 0]
    return min(usable, key=price)["id"] if usable else None
