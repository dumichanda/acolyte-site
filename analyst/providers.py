"""Client-facing text never names Acolyte's data suppliers (listing portals, price and data APIs).

Reports, briefs, charts and showcase results say "third-party data providers" instead. Applied to everything a report
or brief carries before it is stored, served or exported, and to market-data cells shown to users. The companies being
analysed (retailers, Amazon.co.za, Takealot, employers, agencies) are subjects, not suppliers, and keep their names.
Adzuna's attribution on the Automation Index stays: its licence requires it.
"""
from __future__ import annotations

import re

# Most specific first. Each pattern also catches the bare portal codes stored in the data (privateproperty, property24).
_PORTAL = r"(?:Private\s?Property|privateproperty|Property24|property24)"
_RULES = [
    # search-interest data, where a portal's name is the search term: "Property24 searches" -> "property-portal searches"
    (_PORTAL + r"\s+(searches|search interest|search volume)", r"property-portal \1"),
    (r"(searches|search interest)\s+for\s+" + _PORTAL, r"\1 for property portals"),
    (r"\b(?:Property24|property24)\s+(rows|data|listings|counts|newest listings)", r"\1 from a second third-party provider"),
    (r"\b(?:Private\s?Property|privateproperty)\s+(rows|data|listings|counts)", r"\1 from a third-party provider"),
    (r"\b(?:listings?|homes|properties|data|prices|stock)\s+(?:on|from|via)\s+(?:Private\s?Property|privateproperty|Property24|property24)"
     r"(?:\s+(?:and|&|or)\s+(?:Private\s?Property|privateproperty|Property24|property24))?",
     lambda m: m.group(0).split()[0] + " from third-party data providers"),
    (r"\((?:Private\s?Property|privateproperty|Property24|property24)(?:\s*(?:\+|and|&|,)\s*(?:Private\s?Property|privateproperty|Property24|property24))?(?:\s+listings)?\)",
     "(third-party data providers)"),
    (r"\b(?:Private\s?Property|privateproperty)(?:'s)?\b", "a third-party data provider"),
    (r"\b[Pp]roperty24(?:'s)?\b", "a second third-party data provider"),
    (r"\bGoogle\s+Shopping(?:\s+(?:South\s+Africa|SA|ZA))?\b", "third-party online price data"),
    (r"\bScrappa(?:\s+API)?\b", "a third-party data provider"),
    (r"\bpp\.co\.za\b|\bprivateproperty\.co\.za\b|\bproperty24\.com\b", "a third-party data provider"),
]
_COMPILED = [(re.compile(p, re.I), r) for p, r in _RULES]
_ANY = re.compile(r"private\s?property|property24|google\s+shopping|scrappa", re.I)


_WHOLE = {"privateproperty": "Property portal", "private property": "Property portal", "property24": "Property portal 2",
          "google shopping": "Online prices", "google shopping south africa": "Online prices", "google shopping sa": "Online prices",
          "scrappa": "Third-party data"}


def scrub(text: str) -> str:
    if not isinstance(text, str) or not _ANY.search(text):
        return text
    whole = _WHOLE.get(re.sub(r"\s+", " ", text.strip().lower()))
    if whole:   # a label on its own (a chart series, a table cell)
        return whole
    for rx, rep in _COMPILED:
        text = rx.sub(rep, text)
    text = re.sub(r"\ba a\b", "a", text)
    text = re.sub(r"(^|[.!?]\s+|\n\s*)(a (?:second )?third-party)", lambda m: m.group(1) + m.group(2)[0].upper() + m.group(2)[1:], text)
    text = re.sub(r"(third-party data providers?)(?:\s*(?:,|and|&|\+)\s*(?:a\s+)?(?:second\s+)?third-party data providers?)+", r"third-party data providers", text)
    return text


def scrub_obj(o):
    """Every string inside a report, brief or chart (keys untouched)."""
    if isinstance(o, str):
        return scrub(o)
    if isinstance(o, list):
        return [scrub_obj(v) for v in o]
    if isinstance(o, dict):
        return {k: (v if k in ("sql", "url", "link", "href") else scrub_obj(v)) for k, v in o.items()}
    return o
