"""Small, polite web helpers shared by the enrichment steps: search, fetch, text, emails, geocoding.

Search provider (first one configured wins):
  BRAVE_API_KEY   Brave Search API (has a free plan: https://brave.com/search/api/)
  (none)          DuckDuckGo's HTML results page: free and keyless, but unofficial and rate-limited, so
                  we keep volumes low and pause between requests.
"""
import html
import os
import re
import time
from urllib.parse import parse_qs, unquote, urlparse

import requests

SITE = "https://dumichanda.github.io/acolyte-site/"
UA = {"User-Agent": f"Mozilla/5.0 (compatible; AcolyteIndexBot/1.0; +{SITE})", "Accept-Language": "en-ZA,en;q=0.8"}
session = requests.Session()
session.headers.update(UA)

# Sites that are never a company's own website.
NOT_COMPANY = re.compile(
    r"linkedin|facebook|instagram|twitter|x\.com|youtube|tiktok|wikipedia|pnet|careers24|careerjunction|indeed|adzuna|"
    r"glassdoor|jobmail|executiveplacements|gumtree|jobvine|joburgjobs|bizcommunity|zoominfo|crunchbase|dnb\.com|"
    r"opencorporates|b2bhint|bizapedia|yellowpages|brabys|cylex|snupit|hellopeter|google\.|bing\.|duckduckgo|"
    r"bloomberg|reuters|news24|iol\.co|businesstech|moneyweb|dailymaverick|timeslive|myjobmag|jooble|careerjet|"
    r"jobplacements|recruitmyjob|salary|payscale|africa-?business|companies?-?(list|directory)|sajobs|whatjobs",
    re.I,
)
GENERIC_INBOX = re.compile(r"^(info|hello|contact|enquir(y|ies)|sales|admin|office|reception|general|business|"
                           r"marketing|accounts|support|connect|letstalk|talk|team)[a-z0-9._-]*@", re.I)
_last = {"search": 0.0, "geo": 0.0}


def _pause(kind: str, seconds: float) -> None:
    wait = _last[kind] + seconds - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[kind] = time.time()


def domain(url: str) -> str:
    host = urlparse(url if "//" in url else "https://" + url).hostname or ""
    return host.lower().removeprefix("www.")


def search(query: str, n: int = 10) -> list[dict]:
    """[{title, url, snippet}] — empty list on any failure."""
    key = os.environ.get("BRAVE_API_KEY")
    try:
        if key:
            _pause("search", 1.1)
            r = session.get("https://api.search.brave.com/res/v1/web/search", timeout=15,
                            params={"q": query, "count": n, "country": "ZA"},
                            headers={"X-Subscription-Token": key, "Accept": "application/json"})
            r.raise_for_status()
            return [{"title": x.get("title", ""), "url": x.get("url", ""), "snippet": x.get("description", "")}
                    for x in r.json().get("web", {}).get("results", [])][:n]
        _pause("search", 4.0)
        r = session.post("https://html.duckduckgo.com/html/", data={"q": query, "kl": "za-en"}, timeout=15)
        if r.status_code != 200:
            return []
        out = []
        for m in re.finditer(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>.*?'
                             r'(?:class="result__snippet"[^>]*>(.*?)</a>)?', r.text, re.S):
            href = html.unescape(m.group(1))
            if "uddg=" in href:
                href = unquote(parse_qs(urlparse(href).query).get("uddg", [href])[0])
            out.append({"title": strip_tags(m.group(2)), "url": href, "snippet": strip_tags(m.group(3) or "")})
        return out[:n]
    except (requests.RequestException, ValueError):
        return []


def fetch(url: str, timeout: int = 12) -> str | None:
    try:
        r = session.get(url, timeout=timeout, allow_redirects=True)
        if r.status_code == 200 and "html" in r.headers.get("content-type", "html"):
            return r.text
    except requests.RequestException:
        pass
    return None


def strip_tags(s: str) -> str:
    s = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer|header)[^>]*>.*?</\1>", " ", s or "")
    s = re.sub(r"(?s)<br\s*/?>|</p>|</li>|</h\d>|</div>", "\n", s)
    s = html.unescape(re.sub(r"(?s)<[^>]+>", " ", s))
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def meta_description(page: str) -> str:
    m = re.search(r'<meta[^>]+(?:name|property)=["\'](?:og:)?description["\'][^>]+content=["\']([^"\']{20,400})', page, re.I) \
        or re.search(r'<meta[^>]+content=["\']([^"\']{20,400})["\'][^>]+(?:name|property)=["\'](?:og:)?description', page, re.I)
    return html.unescape(m.group(1)).strip() if m else ""


def generic_emails(page: str, site_domain: str) -> list[str]:
    """Role-based inboxes (info@, hello@…) on the company's own domain only. Personal addresses are ignored."""
    found = set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", html.unescape(page)))
    root = site_domain.split(".")[0]
    return sorted(e.lower() for e in found if GENERIC_INBOX.match(e) and root in e.split("@")[1].lower()
                  and not e.lower().endswith((".png", ".jpg", ".webp", ".svg")))


def phones(text: str) -> list[str]:
    nums = re.findall(r"(?:\+27|\b0)(?:\s*\(?0?\)?\s*)?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b", text)
    return list(dict.fromkeys(re.sub(r"\s+", " ", n).strip() for n in nums))[:2]


def links(page: str, base: str) -> list[str]:
    from urllib.parse import urljoin
    return [urljoin(base, html.unescape(h)) for h in re.findall(r'href=["\']([^"\'#]+)', page, re.I)]


def geocode(place: str) -> tuple[float, float] | None:
    """OpenStreetMap Nominatim (free; usage policy: max 1 request/second, identify the app)."""
    _pause("geo", 1.1)
    try:
        r = session.get("https://nominatim.openstreetmap.org/search", timeout=15,
                        params={"q": place, "format": "json", "limit": 1, "countrycodes": "za"})
        if r.status_code == 200 and r.json():
            return float(r.json()[0]["lat"]), float(r.json()[0]["lon"])
    except (requests.RequestException, ValueError, KeyError):
        pass
    return None
