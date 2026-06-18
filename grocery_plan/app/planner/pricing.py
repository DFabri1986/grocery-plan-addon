"""
Best-effort current-price lookups from Coles and Woolworths.

These work from a residential IP (e.g. the Home Assistant host) with a
browser-like User-Agent; they are NOT guaranteed — the vendors bot-protect
their sites and may block or change their APIs at any time. Callers must handle
a None / not-found result gracefully. Pure stdlib (no extra dependencies).
"""
import http.cookiejar
import json
import re
import urllib.parse
import urllib.request

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT = 20
_coles_build = {"id": None}


def _opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def _fetch(opener, url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("User-Agent", UA)
    req.add_header("Accept", "application/json, text/html;q=0.9")
    req.add_header("Accept-Language", "en-AU,en;q=0.9")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with opener.open(req, timeout=TIMEOUT) as resp:
        return resp.read().decode("utf-8", "replace")


def lookup_woolworths(term):
    op = _opener()
    q = urllib.parse.quote(term)
    ref = f"https://www.woolworths.com.au/shop/search/products?searchTerm={q}"
    _fetch(op, ref)  # prime cookies
    body = json.dumps({
        "SearchTerm": term, "PageSize": 5, "PageNumber": 1,
        "SortType": "TraderRelevance", "Filters": [],
    }).encode()
    txt = _fetch(
        op, "https://www.woolworths.com.au/apis/ui/Search/products",
        headers={"Content-Type": "application/json", "Referer": ref}, data=body,
    )
    data = json.loads(txt)
    for grp in data.get("Products") or []:
        for p in grp.get("Products") or []:
            price = p.get("Price")
            if price:
                return {
                    "price": float(price),
                    "name": p.get("DisplayName") or p.get("Name"),
                    "was": p.get("WasPrice") or None,
                }
    return None


def lookup_coles(term):
    op = _opener()
    build = _coles_build["id"]
    if not build:
        home = _fetch(op, "https://www.coles.com.au/")
        m = re.search(r'"buildId":"([^"]+)"', home)
        if not m:
            return None
        build = _coles_build["id"] = m.group(1)
    q = urllib.parse.quote(term)
    url = f"https://www.coles.com.au/_next/data/{build}/en/search/products.json?q={q}"
    try:
        txt = _fetch(op, url)
    except urllib.error.HTTPError:
        # build id likely rotated; refresh once and retry
        _coles_build["id"] = None
        home = _fetch(op, "https://www.coles.com.au/")
        m = re.search(r'"buildId":"([^"]+)"', home)
        if not m:
            return None
        build = _coles_build["id"] = m.group(1)
        txt = _fetch(op, f"https://www.coles.com.au/_next/data/{build}/en/search/products.json?q={q}")
    data = json.loads(txt)
    hits = []

    def walk(o):
        if isinstance(o, dict):
            pr = o.get("pricing")
            if isinstance(pr, dict) and pr.get("now"):
                hits.append({"name": o.get("name"), "price": float(pr["now"]),
                             "was": pr.get("was") or None})
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    return hits[0] if hits else None


def lookup_price(term, vendor):
    """Return {price, name, was} or None. Never raises."""
    try:
        if vendor == "Woolworths":
            return lookup_woolworths(term)
        if vendor == "Coles":
            return lookup_coles(term)
    except Exception:
        return None
    return None
