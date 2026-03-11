"""
Reusable Website Security Analyzer — same engine as Fake Website Detection.
Single entry point: analyze_website(url) → risk_score, risk_level, signals.
Used by: /detect_fake_advanced and /compare_apps_advanced.
"""

import logging
import os
import re
import socket
import ssl
import hashlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    requests = None
try:
    import whois
except ImportError:
    whois = None
try:
    import dns.resolver
except ImportError:
    dns = None

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (from env)
# ---------------------------------------------------------------------------
GOOGLE_SAFE_BROWSING_API_KEY = os.environ.get("GOOGLE_SAFE_BROWSING_API_KEY", "")
VIRUSTOTAL_API_KEY = os.environ.get("VIRUSTOTAL_API_KEY", "")
API_TIMEOUT = 5
WHOIS_TIMEOUT = 5
PAGE_FETCH_TIMEOUT = 6
LEGAL_PAGE_PATHS = ["/privacy", "/terms", "/contact"]
LEGAL_HEAD_TIMEOUT = 3
MISSING_LEGAL_WEIGHT = 1  # per missing page for weighted sum

ADVANCED_SUSPICIOUS_KEYWORDS = [
    "guaranteed 100% win", "instant jackpot", "no risk earning",
    "limited time huge cash", "act now", "urgent action required",
    "click here immediately", "free money", "winner", "claim prize",
    "congratulations you won", "verify account", "suspended account",
    "click to verify", "update payment", "account locked",
]
KNOWN_BRANDS = [
    "amazon", "paypal", "apple", "microsoft", "google", "facebook",
    "netflix", "spotify", "ebay", "alibaba", "walmart", "target",
    "bank of america", "chase", "wells fargo", "citibank",
]


def _validate_url(url: str) -> tuple[str | None, str]:
    if not url or not isinstance(url, str):
        return None, "Invalid URL"
    url = url.strip()
    if url.startswith(("http://localhost", "http://127.0.0.1", "http://0.0.0.0")):
        return None, "Local URLs not allowed"
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return None, "Invalid domain"
        try:
            ip = socket.gethostbyname(parsed.netloc)
            if ip.startswith(("127.", "10.", "192.168.", "172.16.")):
                return None, "Private IP addresses not allowed"
        except Exception:
            pass
        return url, ""
    except Exception as e:
        return None, f"URL validation failed: {str(e)}"


def _extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.netloc or parsed.path.split("/")[0]
        return (host or "").replace("www.", "").split(":")[0].lower()
    except Exception:
        return ""


def _get_domain_age_days(domain: str) -> tuple[int | None, bool]:
    if not domain or not whois:
        return None, False
    try:
        def _run():
            w = whois.whois(domain)
            created = w.creation_date
            if created is None:
                return None, False
            if isinstance(created, list):
                created = created[0]
            if isinstance(created, datetime):
                return (datetime.utcnow() - created).days, True
            return None, False
        with ThreadPoolExecutor(max_workers=1) as ex:
            return ex.submit(_run).result(timeout=WHOIS_TIMEOUT)
    except Exception:
        return None, False


def _check_ssl_certificate(url: str) -> dict:
    result = {"valid": False, "expired": False, "issuer": None, "days_until_expiry": None}
    try:
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return result
        hostname = parsed.netloc.split(":")[0]
        port = parsed.port or 443
        context = ssl.create_default_context()
        with socket.create_connection((hostname, port), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
                result["valid"] = True
                result["issuer"] = dict(x[0] for x in cert.get("issuer", []))
                not_after = cert.get("notAfter")
                if not_after:
                    expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
                    result["days_until_expiry"] = (expiry - datetime.utcnow()).days
                    result["expired"] = result["days_until_expiry"] < 0
    except Exception as e:
        logger.debug("SSL check failed: %s", e)
    return result


def _check_google_safe_browsing(url: str) -> dict:
    result = {"flagged": False, "threat_types": [], "api_error": None}
    if not GOOGLE_SAFE_BROWSING_API_KEY or not requests:
        result["api_error"] = "API key not configured"
        return result
    try:
        api_url = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
        payload = {
            "client": {"clientId": "lexiclear", "clientVersion": "1.0.0"},
            "threatInfo": {
                "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
                "platformTypes": ["ANY_PLATFORM"],
                "threatEntryTypes": ["URL"],
                "threatEntries": [{"url": url}],
            },
        }
        r = requests.post(
            f"{api_url}?key={GOOGLE_SAFE_BROWSING_API_KEY}",
            json=payload,
            timeout=API_TIMEOUT,
            headers={"Content-Type": "application/json"},
        )
        if r.status_code == 200:
            data = r.json()
            if data.get("matches"):
                result["flagged"] = True
                result["threat_types"] = [m.get("threatType", "") for m in data["matches"]]
        else:
            result["api_error"] = f"API error: {r.status_code}"
    except Exception as e:
        result["api_error"] = str(e)
    return result


def _check_virustotal(url: str) -> dict:
    result = {"detections": 0, "total_scans": 0, "api_error": None}
    if not VIRUSTOTAL_API_KEY or not requests:
        result["api_error"] = "API key not configured"
        return result
    try:
        api_url = "https://www.virustotal.com/vtapi/v2/url/report"
        r = requests.get(api_url, params={"apikey": VIRUSTOTAL_API_KEY, "resource": url}, timeout=API_TIMEOUT)
        if r.status_code == 200:
            data = r.json()
            if data.get("response_code") == 1:
                scans = data.get("scans", {})
                result["total_scans"] = len(scans)
                result["detections"] = sum(1 for s in scans.values() if s.get("detected"))
        else:
            result["api_error"] = f"API error: {r.status_code}"
    except Exception as e:
        result["api_error"] = str(e)
    return result


def _analyze_url_structure(url: str) -> dict:
    result = {"score": 0, "issues": []}
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        try:
            socket.inet_aton(hostname.split(":")[0])
            result["score"] += 10
            result["issues"].append("Uses IP address instead of domain")
        except Exception:
            pass
        if hostname.count("-") > 3:
            result["score"] += 5
            result["issues"].append("Excessive hyphens")
        if re.search(r"\d{6,}", hostname):
            result["score"] += 5
            result["issues"].append("Long number sequences")
        hostname_no_dots = hostname.replace(".", "")
        for brand in KNOWN_BRANDS:
            if brand in hostname_no_dots and hostname_no_dots != brand:
                if any(c in hostname_no_dots for c in "0o1il"):
                    result["score"] += 8
                    result["issues"].append("Possible brand spoofing")
                    break
        if len(hostname.split(".")) > 4:
            result["score"] += 3
            result["issues"].append("Excessive subdomains")
    except Exception as e:
        logger.debug("URL structure error: %s", e)
    return result


def _fetch_page(url: str) -> tuple[str | None, str | None]:
    if not requests:
        return None, None
    try:
        u = url if "://" in url else f"https://{url}"
        r = requests.get(u, timeout=PAGE_FETCH_TIMEOUT, headers={"User-Agent": "LexiClear/1.0"})
        r.raise_for_status()
        text = (r.text or "")[:50000]
        return r.text, text
    except Exception:
        return None, None


def _analyze_content_risks(html: str, text: str) -> dict:
    result = {"suspicious_count": 0, "urgency_score": 0, "popup_count": 0, "fake_badges": False}
    combined = (html or "").lower() + " " + (text or "").lower()
    for kw in ADVANCED_SUSPICIOUS_KEYWORDS:
        if kw in combined:
            result["suspicious_count"] += 1
    for pattern in [r"act\s+now", r"limited\s+time", r"expires\s+soon", r"only\s+\d+\s+left", r"hurry", r"urgent"]:
        if re.search(pattern, combined, re.IGNORECASE):
            result["urgency_score"] += 2
    for pattern in [r"onclick.*alert", r"window\.open", r"popup"]:
        result["popup_count"] += len(re.findall(pattern, html or "", re.IGNORECASE))
    if any(re.search(p, combined, re.IGNORECASE) for p in ["verified.*secure", "trusted.*site", "ssl.*certified", "award.*winning", "best.*service"]):
        result["fake_badges"] = True
    return result


def _check_missing_legal_pages_count(base_url: str) -> int:
    """Return count of missing legal pages (0–3)."""
    if not requests:
        return len(LEGAL_PAGE_PATHS)
    try:
        parsed = urlparse(base_url if "://" in base_url else f"https://{base_url}")
        base = f"{parsed.scheme or 'https'}://{parsed.netloc or parsed.path.split('/')[0]}".rstrip("/")
    except Exception:
        return len(LEGAL_PAGE_PATHS)
    missing = 0
    for path in LEGAL_PAGE_PATHS:
        try:
            r = requests.head(f"{base}{path}", timeout=LEGAL_HEAD_TIMEOUT, headers={"User-Agent": "LexiClear/1.0"})
            if r.status_code >= 400:
                missing += 1
        except Exception:
            missing += 1
    return missing


def _check_dns_records(domain: str) -> dict:
    result = {"has_mx": False, "has_txt": False, "suspicious_spf": False, "dns_error": None}
    if not dns:
        result["dns_error"] = "DNS library not available"
        return result
    try:
        resolver = dns.resolver.Resolver()
        resolver.timeout = 3
        resolver.lifetime = 3
        try:
            resolver.resolve(domain, "MX")
            result["has_mx"] = True
        except Exception:
            pass
        try:
            txt = resolver.resolve(domain, "TXT")
            result["has_txt"] = len(txt) > 0
        except Exception:
            pass
    except Exception as e:
        result["dns_error"] = str(e)
    return result


def _compute_advanced_risk_score(signals: dict) -> tuple[int, str]:
    score = 0
    if signals.get("google_flagged"):
        score += 40
    vt = signals.get("virustotal_detections", 0)
    if vt > 0:
        score += min(25, vt * 5)
    age_days = signals.get("domain_age_days")
    if age_days is not None:
        if age_days < 90:
            score += 15
        elif age_days < 180:
            score += 8
    ssl_info = signals.get("ssl_info", {})
    if not ssl_info.get("valid"):
        if signals.get("url_scheme") == "http":
            score += 20
    elif ssl_info.get("expired"):
        score += 10
    content = signals.get("content_risks", {})
    if content.get("suspicious_count", 0) > 3:
        score += 10
    elif content.get("urgency_score", 0) > 5:
        score += 8
    url_struct = signals.get("url_structure", {})
    score += min(10, url_struct.get("score", 0))
    missing = signals.get("missing_legal_pages", 0)
    score += min(5, missing * 2)
    score = max(0, min(100, score))
    if score <= 20:
        level = "Safe"
    elif score <= 40:
        level = "Low Risk"
    elif score <= 60:
        level = "Moderate Risk"
    elif score <= 80:
        level = "High Risk"
    else:
        level = "Critical / Likely Scam"
    return score, level


def analyze_website(url: str) -> dict:
    """
    Run full cybersecurity analysis for one URL (same engine as Fake Website Detection).
    Returns dict with: success, name (optional), url, risk_score, risk_level, signals, error.
    On failure: success=False, error set; other keys may be missing.
    """
    out = {"success": False, "url": url, "risk_score": None, "risk_level": None, "signals": None, "error": None}
    validated, err = _validate_url(url)
    if not validated:
        out["error"] = err or "Invalid URL"
        return out
    url = validated
    parsed = urlparse(url)
    domain = _extract_domain(url)
    signals = {}

    try:
        with ThreadPoolExecutor(max_workers=5) as executor:
            f_age = executor.submit(_get_domain_age_days, domain)
            f_ssl = executor.submit(_check_ssl_certificate, url)
            f_sb = executor.submit(_check_google_safe_browsing, url)
            f_vt = executor.submit(_check_virustotal, url)
            f_url = executor.submit(_analyze_url_structure, url)
            age_days, _ = f_age.result(timeout=WHOIS_TIMEOUT + 2)
            ssl_info = f_ssl.result(timeout=5)
            safe_browsing = f_sb.result(timeout=API_TIMEOUT + 2)
            virustotal = f_vt.result(timeout=API_TIMEOUT + 2)
            url_structure = f_url.result(timeout=2)

        signals["domain_age_days"] = age_days
        signals["ssl_valid"] = ssl_info.get("valid", False)
        signals["ssl_expired"] = ssl_info.get("expired", False)
        signals["google_flagged"] = safe_browsing.get("flagged", False)
        signals["virustotal_detections"] = virustotal.get("detections", 0)
        signals["url_structure"] = {"score": url_structure.get("score", 0), "issues": url_structure.get("issues", [])}
        signals["ssl_info"] = ssl_info
        signals["url_scheme"] = parsed.scheme

        html, text = _fetch_page(url)
        content_risks = _analyze_content_risks(html or "", text or "")
        signals["suspicious_keywords_found"] = content_risks.get("suspicious_count", 0)
        signals["content_risks"] = content_risks

        missing_pages = _check_missing_legal_pages_count(url)
        signals["missing_legal_pages"] = missing_pages

        try:
            signals["dns_info"] = _check_dns_records(domain)
        except Exception:
            pass

        risk_score, risk_level = _compute_advanced_risk_score(signals)
        out["success"] = True
        out["risk_score"] = risk_score
        out["risk_level"] = risk_level
        out["signals"] = signals
    except Exception as e:
        logger.exception("analyze_website failed for %s", url)
        out["error"] = str(e)
    return out
