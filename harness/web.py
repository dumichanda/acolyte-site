"""Web tools for agents: web_search and fetch_page.

web_search providers, first available wins:
  BRAVE_API_KEY       Brave Search API
  OPENROUTER_API_KEY  OpenRouter's web plugin on SEARCH_MODEL (default: the agent model); returns the cited sources
  (none)              DuckDuckGo results page (free, but blocked from many cloud servers)
fetch_page remembers every page it read in ctx["fetched"], so save-tools can verify claims against real pages.
"""
import os
import re

import requests

from webtools import domain, fetch, search as basic_search, strip_tags

from .core import Tool
from .providers import OpenRouterAdapter, ProviderError


def norm(url: str) -> str:
    url = re.sub(r"[?#].*$", "", (url or "").strip().lower())
    return re.sub(r"^https?://(www\.)?", "", url).rstrip("/")


def _openrouter_search(ctx, query: str, n: int) -> list[dict]:
    model = os.environ.get("SEARCH_MODEL") or ctx.get("model") or ""
    if not model or model.startswith("claude-"):
        model = os.environ.get("SEARCH_MODEL", "")
    if not model:
        return []
    a = OpenRouterAdapter(model, plugins=[{"id": "web", "max_results": n}])
    turn = a.step("You are a search engine. List the most relevant results for the query, one per line: title - URL.",
                  [{"role": "user", "content": query}], [])
    ctx["extra_cost"] = ctx.get("extra_cost", 0.0) + turn.cost
    out = [{"title": c["title"], "url": c["url"], "snippet": (c.get("content") or "")[:300]} for c in turn.citations if c.get("url")]
    if not out:  # some models put the links in the text instead of annotations
        out = [{"title": "", "url": u, "snippet": ""} for u in re.findall(r"https?://[^\s)\]>\"']+", turn.text or "")]
    return out[:n]


def web_search(ctx, query: str, max_results: int = 8) -> dict:
    n = max(1, min(int(max_results or 8), 10))
    results, via = [], ""
    if os.environ.get("BRAVE_API_KEY"):
        results, via = basic_search(query, n), "brave"
    if not results and os.environ.get("OPENROUTER_API_KEY"):
        try:
            results, via = _openrouter_search(ctx, query, n), "openrouter"
        except ProviderError as e:
            via = f"openrouter error: {e}"
    if not results:
        results, via = basic_search(query, n), via or "duckduckgo"
    for r in results:
        ctx.setdefault("seen_urls", set()).add(norm(r["url"]))
    ctx["stats"]["searches"] = ctx["stats"].get("searches", 0) + 1
    return {"query": query, "via": via, "results": results} if results else \
        {"query": query, "via": via, "results": [], "note": "No results. Try a different query."}


def fetch_page(ctx, url: str) -> dict:
    if not re.match(r"^https?://", url or ""):
        return {"error": "url must start with http(s)://"}
    try:
        html = fetch(url, timeout=15)
    except requests.RequestException:
        html = None
    if not html:
        return {"url": url, "error": "Could not open the page (blocked, not found or not HTML)."}
    title = (re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S) or [None, ""])[1].strip()
    text = strip_tags(html)
    ctx.setdefault("fetched", {})[norm(url)] = {"url": url, "title": title, "text": text, "html": html}
    ctx["stats"]["pages"] = ctx["stats"].get("pages", 0) + 1
    return {"url": url, "domain": domain(url), "title": title[:200], "text": text[:5000]}


SEARCH = Tool("web_search", "Search the web. Returns titles, URLs and snippets. Prefer specific queries.",
              {"type": "object", "properties": {"query": {"type": "string"}, "max_results": {"type": "integer"}},
               "required": ["query"], "additionalProperties": False}, web_search, max_calls=15)
FETCH = Tool("fetch_page", "Open a web page and read its text (first ~5000 characters). Use it to verify facts before saving.",
             {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"], "additionalProperties": False},
             fetch_page, max_calls=30)
