"""
App-to-App Comparison Engine — LexiClear
Compares one input app/website against predefined competitors in the same domain.
Uses risk metrics: SSL, legal pages, suspicious keywords, domain age.
Ranks safest → riskiest; recommends the safest app.
Modular, hackathon-ready, demo-friendly.
"""

import logging
import re
from datetime import datetime, timedelta
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    requests = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    import whois
except ImportError:
    whois = None

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Domain configuration: 10 domains with display name and 5–10 apps (name + URL).
# Used for domain detection and competitor list selection.
# ---------------------------------------------------------------------------
DOMAINS = {
    "E-commerce": [
        {"name": "Amazon", "url": "https://www.amazon.in"},
        {"name": "Flipkart", "url": "https://www.flipkart.com"},
        {"name": "Meesho", "url": "https://www.meesho.com"},
        {"name": "Myntra", "url": "https://www.myntra.com"},
        {"name": "Snapdeal", "url": "https://www.snapdeal.com"},
    ],
    "Food Delivery": [
        {"name": "Swiggy", "url": "https://www.swiggy.com"},
        {"name": "Zomato", "url": "https://www.zomato.com"},
        {"name": "Dunzo", "url": "https://www.dunzo.com"},
        {"name": "Domino's", "url": "https://www.dominos.co.in"},
        {"name": "McDelivery", "url": "https://www.mcdelivery.co.in"},
    ],
    "Travel/Booking": [
        {"name": "MakeMyTrip", "url": "https://www.makemytrip.com"},
        {"name": "Yatra", "url": "https://www.yatra.com"},
        {"name": "Goibibo", "url": "https://www.goibibo.com"},
        {"name": "Cleartrip", "url": "https://www.cleartrip.com"},
        {"name": "OYO", "url": "https://www.oyorooms.com"},
    ],
    "Social Media": [
        {"name": "Facebook", "url": "https://www.facebook.com"},
        {"name": "Instagram", "url": "https://www.instagram.com"},
        {"name": "Twitter", "url": "https://twitter.com"},
        {"name": "LinkedIn", "url": "https://www.linkedin.com"},
        {"name": "Snapchat", "url": "https://www.snapchat.com"},
    ],
    "Finance/Banking": [
        {"name": "Paytm", "url": "https://paytm.com"},
        {"name": "PhonePe", "url": "https://www.phonepe.com"},
        {"name": "Google Pay", "url": "https://pay.google.com"},
        {"name": "ICICI", "url": "https://www.icicibank.com"},
        {"name": "HDFC", "url": "https://www.hdfcbank.com"},
    ],
    "Streaming/Entertainment": [
        {"name": "Netflix", "url": "https://www.netflix.com"},
        {"name": "Prime Video", "url": "https://www.primevideo.com"},
        {"name": "Disney+ Hotstar", "url": "https://www.hotstar.com"},
        {"name": "SonyLiv", "url": "https://www.sonyliv.com"},
        {"name": "Zee5", "url": "https://www.zee5.com"},
    ],
    "Education/EdTech": [
        {"name": "Byju's", "url": "https://byjus.com"},
        {"name": "Unacademy", "url": "https://unacademy.com"},
        {"name": "Coursera", "url": "https://www.coursera.org"},
        {"name": "Udemy", "url": "https://www.udemy.com"},
        {"name": "Khan Academy", "url": "https://www.khanacademy.org"},
    ],
    "News": [
        {"name": "Times of India", "url": "https://timesofindia.indiatimes.com"},
        {"name": "The Hindu", "url": "https://www.thehindu.com"},
        {"name": "NDTV", "url": "https://www.ndtv.com"},
        {"name": "Indian Express", "url": "https://indianexpress.com"},
        {"name": "BBC India", "url": "https://www.bbc.com/hindi"},
    ],
    "Gaming": [
        {"name": "Dream11", "url": "https://www.dream11.com"},
        {"name": "MPL", "url": "https://www.mpl.live"},
        {"name": "Rummy Gold", "url": "https://www.rummygold.com"},
        {"name": "PokerBaazi", "url": "https://www.pokerbaazi.com"},
        {"name": "Ludo King", "url": "https://www.ludoking.com"},
    ],
    "Health/Wellness": [
        {"name": "Practo", "url": "https://www.practo.com"},
        {"name": "1mg", "url": "https://www.1mg.com"},
        {"name": "Medlife", "url": "https://www.medlife.com"},
        {"name": "PharmEasy", "url": "https://pharmeasy.in"},
        {"name": "Portea", "url": "https://www.portea.com"},
    ],
}

# Trigger keywords per domain (for detecting input URL's domain)
DOMAIN_TRIGGERS = {
    "E-commerce": ["amazon", "flipkart", "meesho", "myntra", "snapdeal", "shopify", "ajio"],
    "Food Delivery": ["swiggy", "zomato", "dunzo", "dominos", "mcdelivery", "mcdonald"],
    "Travel/Booking": ["makemytrip", "yatra", "goibibo", "cleartrip", "oyo", "oyorooms"],
    "Social Media": ["facebook", "instagram", "twitter", "linkedin", "snapchat"],
    "Finance/Banking": ["paytm", "phonepe", "google pay", "icici", "hdfc", "pay.google"],
    "Streaming/Entertainment": ["netflix", "primevideo", "hotstar", "sonyliv", "zee5"],
    "Education/EdTech": ["byjus", "unacademy", "coursera", "udemy", "khanacademy"],
    "News": ["timesofindia", "thehindu", "ndtv", "indianexpress", "bbc"],
    "Gaming": ["dream11", "mpl", "rummygold", "pokerbaazi", "ludoking"],
    "Health/Wellness": ["practo", "1mg", "medlife", "pharmeasy", "portea"],
}

DEFAULT_DOMAIN = "E-commerce"
REQUEST_TIMEOUT = 12
USER_AGENT = "LexiClear-AppCompare/1.0"

# Legal/Privacy page paths to check (missing → risk)
LEGAL_PAGE_PATHS = ["/privacy", "/terms", "/contact"]

# Suspicious terms for content-based risk (count occurrences in page text)
SUSPICIOUS_KEYWORDS = [
    "guaranteed", "win", "free money", "instant cash", "no risk",
    "100% win", "jackpot", "limited time", "act now", "click here to claim",
]

# Risk score tiers for status label (risk_score: 0 = safest, 10 = riskiest)
# 0–3 → Safe, 4–6 → Moderate Risk, 7–9 → High Risk, 10 → High Risk / Suspicious
def _risk_status(risk_score: float) -> str:
    if risk_score <= 3:
        return "Safe"
    if risk_score <= 6:
        return "Moderate Risk"
    return "High Risk"


def _normalize_url(url: str) -> str:
    if not url or not isinstance(url, str):
        return ""
    u = url.strip()
    if u and "://" not in u:
        u = f"https://{u}"
    return u


def _extract_domain(url: str) -> str:
    """Extract host (e.g. www.flipkart.com) for domain matching."""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.netloc or parsed.path.split("/")[0]
        return (host or "").replace("www.", "").split(":")[0].lower()
    except Exception:
        return ""


def get_domain_for_url(input_url: str) -> str:
    """Determine the domain/category of the input URL. Returns display name (e.g. 'E-commerce')."""
    domain_key = _extract_domain(input_url)
    if not domain_key:
        return DEFAULT_DOMAIN
    for domain_name, triggers in DOMAIN_TRIGGERS.items():
        if any(t in domain_key for t in triggers):
            return domain_name
    return DEFAULT_DOMAIN


def get_apps_in_domain(domain_name: str, include_primary_url: str | None = None) -> list[dict]:
    """
    Return list of apps to compare: primary (if provided and not already in list) + all competitors.
    Each item: { "name": str, "url": str }.
    """
    apps = list(DOMAINS.get(domain_name, DOMAINS[DEFAULT_DOMAIN]))
    if not include_primary_url:
        return apps
    primary_url = _normalize_url(include_primary_url)
    primary_domain = _extract_domain(primary_url)
    # If primary URL is not in the predefined list, add it at the front with a short name
    for a in apps:
        if _extract_domain(a["url"]) == primary_domain:
            return apps  # already in list
    # Prepend primary as "Your app" or use domain as name
    short_name = primary_domain.split(".")[0] if primary_domain else "Your app"
    return [{"name": short_name.title(), "url": primary_url}] + apps


def _check_ssl(url: str) -> bool:
    """True if URL uses HTTPS."""
    u = (url or "").strip().lower()
    if not u or not u.startswith("http"):
        return True  # assume https when we normalize
    return u.startswith("https://")


def _check_legal_pages_missing(base_url: str) -> int:
    """Count how many of /privacy, /terms, /contact are missing (non-2xx or unreachable)."""
    if not requests:
        return len(LEGAL_PAGE_PATHS)
    try:
        parsed = urlparse(base_url if "://" in base_url else f"https://{base_url}")
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc or parsed.path.split("/")[0]
        base = f"{scheme}://{netloc}".rstrip("/")
    except Exception:
        return len(LEGAL_PAGE_PATHS)
    missing = 0
    for path in LEGAL_PAGE_PATHS:
        try:
            r = requests.head(f"{base}{path}", timeout=5, headers={"User-Agent": USER_AGENT})
            if r.status_code >= 400:
                missing += 1
        except Exception:
            missing += 1
    return missing


def _count_suspicious_keywords(html_or_text: str) -> int:
    """Count how many suspicious terms appear in the page text (case-insensitive)."""
    if not html_or_text:
        return 0
    if BeautifulSoup and html_or_text.strip().startswith("<"):
        try:
            soup = BeautifulSoup(html_or_text, "html.parser")
            for tag in soup(["script", "style"]):
                tag.decompose()
            text = soup.get_text(separator=" ", strip=True).lower()
        except Exception:
            text = html_or_text.lower()
    else:
        text = html_or_text.lower()
    count = 0
    for kw in SUSPICIOUS_KEYWORDS:
        if kw in text:
            count += 1
    return count


def _domain_age_months(domain: str) -> int | None:
    """Return domain age in months from WHOIS creation_date, or None on failure."""
    if not domain or not whois:
        return None
    try:
        w = whois.whois(domain)
        created = w.creation_date
        if created is None:
            return None
        if isinstance(created, list):
            created = created[0]
        delta = datetime.utcnow() - created
        return max(0, delta.days // 30)
    except Exception:
        return None


def _fetch_page(url: str) -> tuple[str | None, str | None]:
    """Fetch URL; return (html, plain_text_snippet). On error return (None, None)."""
    if not requests:
        return None, None
    try:
        u = _normalize_url(url)
        r = requests.get(u, timeout=REQUEST_TIMEOUT, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        html = r.text or ""
        # Strip scripts/styles for text snippet
        text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", html, flags=re.I)
        text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()[:50000]
        return html, text
    except Exception as e:
        logger.warning("fetch failed for %s: %s", url, str(e))
        return None, None


def _compute_risk_score(
    has_ssl: bool,
    legal_pages_missing: int,
    suspicious_keywords_count: int,
    domain_age_months: int | None,
    unreachable: bool,
) -> float:
    """
    Combine risk signals into a single 0–10 risk score (higher = riskier).
    Unreachable → 10. Otherwise: SSL, legal pages, keywords, domain age.
    """
    if unreachable:
        return 10.0
    score = 0.0
    # No SSL: +3
    if not has_ssl:
        score += 3.0
    # Missing legal pages: +0.5 each, max +2
    score += min(2.0, legal_pages_missing * 0.5)
    # Suspicious keywords: +0.3 each, max +2.5
    score += min(2.5, suspicious_keywords_count * 0.3)
    # Domain age: < 6 months = +2.5, WHOIS fail/unknown = +1
    if domain_age_months is None:
        score += 1.0
    elif domain_age_months < 6:
        score += 2.5
    return round(min(10.0, score), 1)


def fetch_risk_metrics(app_name: str, url: str) -> dict:
    """
    For one app URL: fetch page, check SSL, legal pages, keywords, domain age.
    Returns dict with: app, url, risk_score, status, ssl, legal_pages_missing,
    suspicious_keywords_count, domain_age_months. Unreachable → risk_score 10, status High Risk.
    """
    url = _normalize_url(url)
    domain = _extract_domain(url)
    has_ssl = _check_ssl(url)
    html, text = _fetch_page(url)
    unreachable = html is None

    legal_pages_missing = 0 if unreachable else _check_legal_pages_missing(url)
    suspicious_keywords_count = 0 if unreachable else _count_suspicious_keywords(html or text or "")
    domain_age_months = _domain_age_months(domain)

    risk_score = _compute_risk_score(
        has_ssl=has_ssl,
        legal_pages_missing=legal_pages_missing,
        suspicious_keywords_count=suspicious_keywords_count,
        domain_age_months=domain_age_months,
        unreachable=unreachable,
    )
    status = _risk_status(risk_score)

    return {
        "app": app_name,
        "url": url,
        "risk_score": risk_score,
        "status": status,
        "ssl": has_ssl,
        "legal_pages_missing": legal_pages_missing,
        "suspicious_keywords_count": suspicious_keywords_count,
        "domain_age_months": domain_age_months if domain_age_months is not None else 0,
    }


def run_comparison(primary_url: str) -> dict:
    """
    Run full app-to-app comparison.
    1) Detect domain from primary URL.
    2) Get list of apps (primary + competitors in same domain).
    3) For each app, compute risk metrics and risk_score.
    4) Sort safest → riskiest (ascending risk_score).
    5) Recommend the app with lowest risk_score.
    Returns: input_url, domain, comparison_results[], recommended_app.
    """
    primary_url = _normalize_url(primary_url)
    if not primary_url:
        return {
            "input_url": "",
            "domain": DEFAULT_DOMAIN,
            "comparison_results": [],
            "recommended_app": "",
        }

    domain_name = get_domain_for_url(primary_url)
    apps = get_apps_in_domain(domain_name, include_primary_url=primary_url)

    results = []
    for entry in apps:
        metrics = fetch_risk_metrics(entry["name"], entry["url"])
        results.append(metrics)

    # Sort safest → riskiest (ascending risk_score)
    results.sort(key=lambda x: (x["risk_score"], x["app"]))

    recommended_app = results[0]["app"] if results else ""

    return {
        "input_url": primary_url,
        "domain": domain_name,
        "comparison_results": results,
        "recommended_app": recommended_app,
    }
