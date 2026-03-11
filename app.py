"""
Legal Risk Analyzer - Backend API
Steps 3 & 4: Clause Segmentation + Gemini Classification
Run: python app.py
Set GEMINI_API_KEY in environment or .env file.
"""

import json
import logging
import os
import re

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
from concurrent.futures import TimeoutError as FuturesTimeoutError
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    import google.generativeai as genai
except ImportError:
    genai = None

app = Flask(__name__)
CORS(app, origins=["*"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Segmentation config
MAX_INPUT_LENGTH = 8000
MIN_CLAUSE_LENGTH = 20

# Classification config
MAX_CLAUSES_TO_CLASSIFY = 50
GEMINI_TIMEOUT_SECONDS = 10
VALID_CATEGORIES = {"Data", "Financial", "Termination", "Arbitration", "Ownership", "Other"}
DEFAULT_CATEGORY = "Other"

# Risk analysis patterns
RISK_PATTERNS = {
    "data_sharing": [
        r"share.*data.*third.*party",
        r"third.*party.*access",
        r"sell.*data",
        r"data.*partner",
        r"share.*information.*with",
    ],
    "tracking": [
        r"track.*activity",
        r"monitor.*behavior",
        r"surveillance",
        r"cookies.*track",
        r"analytics.*track",
    ],
    "no_user_control": [
        r"no.*control.*data",
        r"cannot.*delete",
        r"cannot.*remove",
        r"data.*retained",
        r"permanent.*data",
    ],
    "broad_permissions": [
        r"unlimited.*right",
        r"any.*purpose",
        r"all.*rights",
        r"broad.*license",
        r"extensive.*permission",
    ],
    "liability_disclaimer": [
        r"not.*liable",
        r"no.*liability",
        r"disclaim.*warranty",
        r"as.*is",
        r"no.*guarantee",
    ],
    "arbitration": [
        r"arbitration",
        r"binding.*arbitration",
        r"waive.*right.*sue",
        r"class.*action.*waiver",
    ],
    "auto_renewal": [
        r"auto.*renew",
        r"automatic.*renewal",
        r"recurring.*charge",
        r"subscription.*renew",
    ],
}

POSITIVE_PATTERNS = {
    "data_protection": [
        r"protect.*data",
        r"data.*security",
        r"encrypt.*data",
        r"secure.*storage",
        r"privacy.*protection",
    ],
    "user_rights": [
        r"delete.*data",
        r"export.*data",
        r"access.*data",
        r"user.*control",
        r"right.*to.*delete",
    ],
    "transparency": [
        r"transparent",
        r"clear.*policy",
        r"explain.*how",
        r"disclose",
        r"inform.*user",
    ],
    "opt_out": [
        r"opt.*out",
        r"unsubscribe",
        r"disable.*tracking",
        r"privacy.*settings",
        r"manage.*preferences",
    ],
    "security": [
        r"secure.*connection",
        r"ssl",
        r"encryption",
        r"secure.*server",
        r"protect.*information",
    ],
}


def segment_clauses(text: str) -> list:
    """Split text into meaningful clauses by period, semicolon, or newline."""
    if not text or not isinstance(text, str):
        return []

    text = text[:MAX_INPUT_LENGTH]
    raw_clauses = re.split(r'[.;\n]+', text)

    clauses = [
        re.sub(r'\s+', ' ', c.strip()).strip()
        for c in raw_clauses
        if c.strip() and len(c.strip()) >= MIN_CLAUSE_LENGTH
    ]

    return clauses


def _parse_gemini_response(text: str) -> str:
    """Extract category from Gemini response. Returns DEFAULT_CATEGORY on failure."""
    if not text or not isinstance(text, str):
        return DEFAULT_CATEGORY

    text = text.strip()
    # Try to find JSON block
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start:end])
            category = data.get("category", "").strip()
            if category in VALID_CATEGORIES:
                return category
        except json.JSONDecodeError:
            pass

    return DEFAULT_CATEGORY


def _call_gemini(model, prompt: str):
    """Call Gemini and return response text. Handles timeout via ThreadPoolExecutor."""
    def _run():
        response = model.generate_content(prompt)
        return response.text if response else None

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_run)
        try:
            return future.result(timeout=GEMINI_TIMEOUT_SECONDS)
        except FuturesTimeoutError:
            logger.warning("Gemini request timed out")
            return None


def classify_clause_with_gemini(clause: str, model) -> str:
    """Send clause to Gemini for classification. Returns category or DEFAULT_CATEGORY."""
    prompt = (
        'Classify the following legal clause into exactly ONE category from: '
        'Data, Financial, Termination, Arbitration, Ownership, Other. '
        'Return only valid JSON with a single key "category". No other text.\n\n'
        f'Clause: {clause[:500]}'
    )
    try:
        text = _call_gemini(model, prompt)
        if text:
            return _parse_gemini_response(text)
    except Exception as e:
        logger.warning("Gemini classification failed: %s", str(e))

    return DEFAULT_CATEGORY


def classify_clauses(clauses: list) -> list:
    """Classify each clause using Gemini. Limits to MAX_CLAUSES_TO_CLASSIFY."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY not set")
        return [
            {"clause": c, "category": DEFAULT_CATEGORY}
            for c in clauses[:MAX_CLAUSES_TO_CLASSIFY]
        ]

    if genai is None:
        logger.error("google-generativeai not installed")
        return [
            {"clause": c, "category": DEFAULT_CATEGORY}
            for c in clauses[:MAX_CLAUSES_TO_CLASSIFY]
        ]

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")

    to_process = clauses[:MAX_CLAUSES_TO_CLASSIFY]
    results = []

    for i, clause in enumerate(to_process):
        category = classify_clause_with_gemini(clause, model)
        results.append({"clause": clause, "category": category})
        if (i + 1) % 10 == 0:
            logger.info("Classified %d/%d clauses", i + 1, len(to_process))

    return results


def analyze_legal_risks(text: str) -> dict:
    """
    Analyze legal text for risks and generate user-friendly pros/cons.
    Returns: {risk_score, risk_level, pros, cons, summary}
    """
    if not text or not isinstance(text, str):
        return {
            "risk_score": 50,
            "risk_level": "Moderate Risk",
            "pros": [],
            "cons": ["Unable to analyze text"],
            "summary": "Analysis unavailable.",
        }

    text_lower = text.lower()
    risk_score = 50  # Start neutral
    risk_findings = []
    positive_findings = []

    # Check risk patterns
    for risk_type, patterns in RISK_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                if risk_type == "data_sharing":
                    risk_score += 12
                    risk_findings.append("Shares data with third parties")
                elif risk_type == "tracking":
                    risk_score += 10
                    risk_findings.append("Tracks user activity")
                elif risk_type == "no_user_control":
                    risk_score += 15
                    risk_findings.append("Limited control over your data")
                elif risk_type == "broad_permissions":
                    risk_score += 8
                    risk_findings.append("Very broad permissions requested")
                elif risk_type == "liability_disclaimer":
                    risk_score += 10
                    risk_findings.append("Limits liability for issues")
                elif risk_type == "arbitration":
                    risk_score += 12
                    risk_findings.append("Requires arbitration instead of court")
                elif risk_type == "auto_renewal":
                    risk_score += 8
                    risk_findings.append("Automatic payment renewal")
                break  # Count each risk type once

    # Check positive patterns
    for pos_type, patterns in POSITIVE_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                if pos_type == "data_protection":
                    risk_score -= 10
                    positive_findings.append("Commits to protecting your data")
                elif pos_type == "user_rights":
                    risk_score -= 12
                    positive_findings.append("You can delete or export your data")
                elif pos_type == "transparency":
                    risk_score -= 8
                    positive_findings.append("Clear and transparent policies")
                elif pos_type == "opt_out":
                    risk_score -= 10
                    positive_findings.append("Options to opt out of tracking")
                elif pos_type == "security":
                    risk_score -= 8
                    positive_findings.append("Uses secure connections")
                break  # Count each positive type once

    # Clamp score between 0-100
    risk_score = max(0, min(100, risk_score))

    # Determine risk level
    if risk_score <= 30:
        risk_level = "Safe"
    elif risk_score <= 60:
        risk_level = "Moderate Risk"
    else:
        risk_level = "High Risk"

    # Generate pros and cons (deduplicate)
    pros = list(dict.fromkeys(positive_findings))[:5]  # Max 5 pros
    cons = list(dict.fromkeys(risk_findings))[:5]  # Max 5 cons

    # If no findings, add defaults
    if not pros and not cons:
        pros = ["No major concerns detected"]
        cons = ["Limited information available"]

    # Generate summary
    if risk_score <= 30:
        summary = "This page appears safe with good privacy protections."
    elif risk_score <= 60:
        summary = "This page has some concerns but may be acceptable with caution."
    else:
        summary = "This page has significant privacy and legal risks. Review carefully."

    return {
        "risk_score": int(risk_score),
        "risk_level": risk_level,
        "pros": pros,
        "cons": cons,
        "summary": summary,
    }


# ---------------------------------------------------------------------------
# Fake Website Detection
# ---------------------------------------------------------------------------
from urllib.parse import urlparse
from datetime import datetime, timedelta

try:
    import whois
except ImportError:
    whois = None

try:
    import requests
except ImportError:
    requests = None

FAKE_WEIGHTS = {
    "domain_age": 3,    # Domain < 6 months old → high suspicion
    "no_ssl": 4,        # No HTTPS → high risk
    "suspicious_keywords": 3,
    "missing_legal_per_page": 1,  # 1 per missing page (privacy, terms, contact)
}

# Scam phrases - page content is lowercased before check
SUSPICIOUS_KEYWORDS = [
    "guaranteed 100% win",
    "instant jackpot",
    "no risk earning",
    "limited time huge cash",
]

# Paths to check if they exist (return 2xx)
LEGAL_PAGE_PATHS = ["/privacy", "/terms", "/contact"]
# Timeouts for authenticity checker (seconds)
WHOIS_TIMEOUT = 5
PAGE_FETCH_TIMEOUT = 6
LEGAL_HEAD_TIMEOUT = 3


def _extract_domain(url: str) -> str:
    """Extract domain from URL (e.g. example.com)."""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.netloc or parsed.path.split("/")[0]
        return host.replace("www.", "").split(":")[0] or ""
    except Exception:
        return ""


def _check_domain_age(domain: str):
    """Return (domain_age weight, whois_ok). If WHOIS fails or times out, treat as suspicious (return 2)."""
    if not domain:
        return 0, True
    if not whois:
        return 0, True

    def _run_whois():
        w = whois.whois(domain)
        created = w.creation_date
        if created is None:
            return 0, True
        if isinstance(created, list):
            created = created[0]
        six_months_ago = datetime.utcnow() - timedelta(days=180)
        if created > six_months_ago:
            return FAKE_WEIGHTS["domain_age"], True
        return 0, True

    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_run_whois)
            return future.result(timeout=WHOIS_TIMEOUT)
    except (FuturesTimeoutError, Exception):
        return 2, False  # WHOIS failure or timeout -> treat as suspicious


def _check_ssl(url: str) -> float:
    """Return no_ssl weight (4) if URL uses http, else 0."""
    u = (url or "").strip().lower()
    if not u:
        return 0
    if not u.startswith("http"):
        u = f"https://{u}"
    if u.startswith("http://"):
        return FAKE_WEIGHTS["no_ssl"]
    return 0


def _check_suspicious_keywords(page_text: str) -> float:
    """Check fetched page content for scam phrases. Returns weight (3) if any match."""
    if not page_text:
        return 0
    text = (page_text or "").lower()
    for kw in SUSPICIOUS_KEYWORDS:
        if kw in text:
            return FAKE_WEIGHTS["suspicious_keywords"]
    return 0


def _check_missing_legal_pages(base_url: str) -> float:
    """
    Check if /privacy, /terms, /contact exist. Runs HEAD requests in parallel.
    Returns 1 per missing page.
    """
    if not requests:
        return FAKE_WEIGHTS["missing_legal_per_page"] * len(LEGAL_PAGE_PATHS)
    try:
        parsed = urlparse(base_url if "://" in base_url else f"https://{base_url}")
        scheme = parsed.scheme or "https"
        netloc = parsed.netloc or parsed.path.split("/")[0]
        base = f"{scheme}://{netloc}".rstrip("/")
    except Exception:
        return FAKE_WEIGHTS["missing_legal_per_page"] * len(LEGAL_PAGE_PATHS)

    def _head(path):
        try:
            r = requests.head(f"{base}{path}", timeout=LEGAL_HEAD_TIMEOUT, headers={"User-Agent": "LexiClear/1.0"})
            return 1 if r.status_code >= 400 else 0
        except Exception:
            return 1

    missing = 0
    with ThreadPoolExecutor(max_workers=len(LEGAL_PAGE_PATHS)) as ex:
        futures = [ex.submit(_head, p) for p in LEGAL_PAGE_PATHS]
        for f in as_completed(futures):
            missing += f.result()
    return missing * FAKE_WEIGHTS["missing_legal_per_page"]


def _fetch_page(url: str):
    """Fetch page; return (html, text). On error return (None, None)."""
    if not requests:
        return None, None
    try:
        u = url if "://" in url else f"https://{url}"
        r = requests.get(u, timeout=PAGE_FETCH_TIMEOUT, headers={"User-Agent": "LexiClear/1.0"})
        r.raise_for_status()
        return r.text, (r.text[:50000] if r.text else "")
    except Exception:
        return None, None


def _get_fake_status(safety_score: float) -> str:
    """Map safety score (0–10, 10 = safe) to professional probability tier."""
    if safety_score >= 10:
        return "Verified / Safe"
    if safety_score >= 7:
        return "Low Risk"
    if safety_score >= 4:
        return "Moderate Risk"
    return "Highly Suspicious"


@app.route("/check_fake", methods=["POST"])
def check_fake():
    """
    Fake website detection endpoint.
    Input: { "url": "https://example.com" } or { "url": "current" } (extension must send actual URL).
    Output: { "url", "fake_score" (0–10 safety: 10=safe), "status", "details": {...} }
    """
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON", "message": "Request body must be valid JSON"}), 400

        url = (data.get("url") or "").strip()
        if not url:
            return jsonify({"error": "Missing url", "message": "Field 'url' is required"}), 400

        if url.lower() == "current":
            return jsonify({
                "error": "url is 'current'",
                "message": "Send the actual page URL from the extension (e.g. from chrome.tabs).",
            }), 400

        if "://" not in url:
            url = f"https://{url}"

        domain = _extract_domain(url)
        details = {
            "domain_age_risk": 0,
            "ssl_risk": 0,
            "keyword_risk": 0,
            "missing_pages_risk": 0,
        }

        # Run slow checks in parallel (WHOIS, page fetch, legal pages)
        with ThreadPoolExecutor(max_workers=3) as ex:
            f_age = ex.submit(_check_domain_age, domain)
            f_page = ex.submit(_fetch_page, url)
            f_legal = ex.submit(_check_missing_legal_pages, url)
            age_score, _ = f_age.result(timeout=WHOIS_TIMEOUT + 1)
            html, text = f_page.result(timeout=PAGE_FETCH_TIMEOUT + 2)
            missing_score = f_legal.result(timeout=(LEGAL_HEAD_TIMEOUT * 2) + 1)

        details["domain_age_risk"] = int(age_score)
        details["missing_pages_risk"] = int(missing_score)

        # 2. No SSL → high risk (instant)
        ssl_score = _check_ssl(url)
        details["ssl_risk"] = int(ssl_score)

        # 3 & 4. Suspicious keywords from fetched page
        fetch_penalty = 3 if html is None else 0  # Site unreachable → suspicious
        kw_score = _check_suspicious_keywords(text or "")
        details["keyword_risk"] = int(kw_score)

        total_risk = (
            details["domain_age_risk"]
            + details["ssl_risk"]
            + details["keyword_risk"]
            + details["missing_pages_risk"]
            + fetch_penalty
        )
        total_risk = min(10.0, round(total_risk, 1))
        # Fake Probability Score as safety score: 10 = Verified/Safe, 0 = Highly Suspicious
        fake_score = round(10.0 - total_risk, 1)
        fake_score = max(0.0, min(10.0, fake_score))
        status = _get_fake_status(fake_score)

        return jsonify({
            "url": url,
            "fake_score": fake_score,
            "status": status,
            "details": details,
        })

    except Exception as e:
        logger.exception("check_fake failed")
        return jsonify({"error": "Server error", "message": str(e)}), 500


# ---------------------------------------------------------------------------
# Advanced Website Intelligence Engine
# Production-grade multi-layered detection system
# ---------------------------------------------------------------------------

import socket
import ssl
import hashlib
import base64
from urllib.parse import urlparse, urljoin

try:
    import dns.resolver
except ImportError:
    dns = None

# API Keys (load from environment)
GOOGLE_SAFE_BROWSING_API_KEY = os.environ.get("GOOGLE_SAFE_BROWSING_API_KEY", "")
VIRUSTOTAL_API_KEY = os.environ.get("VIRUSTOTAL_API_KEY", "")
IPQUALITYSCORE_API_KEY = os.environ.get("IPQUALITYSCORE_API_KEY", "")

# Detection timeouts
ADVANCED_TIMEOUT = 8
API_TIMEOUT = 5

# Suspicious keywords for content analysis
ADVANCED_SUSPICIOUS_KEYWORDS = [
    "guaranteed 100% win", "instant jackpot", "no risk earning",
    "limited time huge cash", "act now", "urgent action required",
    "click here immediately", "free money", "winner", "claim prize",
    "congratulations you won", "verify account", "suspended account",
    "click to verify", "update payment", "account locked",
]

# Known brand names for clone detection
KNOWN_BRANDS = [
    "amazon", "paypal", "apple", "microsoft", "google", "facebook",
    "netflix", "spotify", "ebay", "alibaba", "walmart", "target",
    "bank of america", "chase", "wells fargo", "citibank",
]


def _validate_url(url: str) -> tuple[str | None, str]:
    """
    Validate and normalize URL. Prevents SSRF.
    Returns: (normalized_url, error_message)
    """
    if not url or not isinstance(url, str):
        return None, "Invalid URL"
    
    url = url.strip()
    
    # Prevent SSRF - block localhost and private IPs
    if url.startswith(("http://localhost", "http://127.0.0.1", "http://0.0.0.0")):
        return None, "Local URLs not allowed"
    
    # Normalize URL
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return None, "Invalid domain"
        
        # Block private IP ranges
        try:
            ip = socket.gethostbyname(parsed.netloc)
            if ip.startswith(("127.", "10.", "192.168.", "172.16.")):
                return None, "Private IP addresses not allowed"
        except:
            pass
        
        return url, ""
    except Exception as e:
        return None, f"URL validation failed: {str(e)}"


def _get_domain_age_days(domain: str) -> tuple[int | None, bool]:
    """
    Get domain age in days using WHOIS.
    Returns: (age_days, success)
    """
    if not domain or not whois:
        return None, False
    
    try:
        def _run_whois():
            w = whois.whois(domain)
            created = w.creation_date
            if created is None:
                return None, False
            if isinstance(created, list):
                created = created[0]
            if isinstance(created, datetime):
                age = (datetime.utcnow() - created).days
                return age, True
            return None, False
        
        with ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_run_whois)
            return future.result(timeout=WHOIS_TIMEOUT)
    except Exception:
        return None, False


def _check_ssl_certificate(url: str) -> dict:
    """
    Validate SSL certificate.
    Returns: {valid, expired, issuer, days_until_expiry}
    """
    result = {
        "valid": False,
        "expired": False,
        "issuer": None,
        "days_until_expiry": None,
    }
    
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
                
                # Check expiry
                not_after = cert.get("notAfter")
                if not_after:
                    from datetime import datetime
                    expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z")
                    days_left = (expiry - datetime.utcnow()).days
                    result["days_until_expiry"] = days_left
                    result["expired"] = days_left < 0
    except Exception as e:
        logger.debug(f"SSL check failed: {e}")
    
    return result


def _check_google_safe_browsing(url: str) -> dict:
    """
    Check URL against Google Safe Browsing API.
    Returns: {flagged, threat_types, api_error}
    """
    result = {
        "flagged": False,
        "threat_types": [],
        "api_error": None,
    }
    
    if not GOOGLE_SAFE_BROWSING_API_KEY or not requests:
        result["api_error"] = "API key not configured"
        return result
    
    try:
        # Google Safe Browsing API v4
        api_url = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
        
        # Hash URL for lookup
        url_hash = hashlib.sha256(url.encode()).hexdigest()
        
        payload = {
            "client": {
                "clientId": "lexiclear",
                "clientVersion": "1.0.0"
            },
            "threatInfo": {
                "threatTypes": ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
                "platformTypes": ["ANY_PLATFORM"],
                "threatEntryTypes": ["URL"],
                "threatEntries": [{"url": url}]
            }
        }
        
        response = requests.post(
            f"{api_url}?key={GOOGLE_SAFE_BROWSING_API_KEY}",
            json=payload,
            timeout=API_TIMEOUT,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            data = response.json()
            if "matches" in data and data["matches"]:
                result["flagged"] = True
                result["threat_types"] = [m.get("threatType", "") for m in data["matches"]]
        elif response.status_code == 400:
            result["api_error"] = "Invalid request"
        else:
            result["api_error"] = f"API error: {response.status_code}"
    except Exception as e:
        logger.debug(f"Safe Browsing API error: {e}")
        result["api_error"] = str(e)
    
    return result


def _check_virustotal(url: str) -> dict:
    """
    Check URL with VirusTotal API.
    Returns: {detections, total_scans, api_error}
    """
    result = {
        "detections": 0,
        "total_scans": 0,
        "api_error": None,
    }
    
    if not VIRUSTOTAL_API_KEY or not requests:
        result["api_error"] = "API key not configured"
        return result
    
    try:
        # VirusTotal URL scan endpoint
        api_url = "https://www.virustotal.com/vtapi/v2/url/report"
        
        params = {
            "apikey": VIRUSTOTAL_API_KEY,
            "resource": url,
        }
        
        response = requests.get(api_url, params=params, timeout=API_TIMEOUT)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("response_code") == 1:
                scans = data.get("scans", {})
                result["total_scans"] = len(scans)
                result["detections"] = sum(1 for scan in scans.values() if scan.get("detected"))
        elif response.status_code == 204:
            result["api_error"] = "Rate limit exceeded"
        else:
            result["api_error"] = f"API error: {response.status_code}"
    except Exception as e:
        logger.debug(f"VirusTotal API error: {e}")
        result["api_error"] = str(e)
    
    return result


def _analyze_url_structure(url: str) -> dict:
    """
    Analyze URL structure for suspicious patterns.
    Returns: {score, issues}
    """
    result = {
        "score": 0,
        "issues": [],
    }
    
    try:
        parsed = urlparse(url)
        hostname = parsed.netloc.lower()
        
        # Check for IP address instead of domain
        try:
            socket.inet_aton(hostname.split(":")[0])
            result["score"] += 10
            result["issues"].append("Uses IP address instead of domain")
        except:
            pass
        
        # Check for excessive hyphens
        hyphen_count = hostname.count("-")
        if hyphen_count > 3:
            result["score"] += 5
            result["issues"].append(f"Excessive hyphens ({hyphen_count})")
        
        # Check for random strings
        if re.search(r'\d{6,}', hostname):
            result["score"] += 5
            result["issues"].append("Contains long number sequences")
        
        # Check for brand name typos (homograph attacks)
        hostname_no_dots = hostname.replace(".", "")
        for brand in KNOWN_BRANDS:
            if brand in hostname_no_dots and hostname_no_dots != brand:
                # Check for common typos
                if any(c in hostname_no_dots for c in "0o1il"):
                    result["score"] += 8
                    result["issues"].append(f"Possible brand name spoofing")
                    break
        
        # Check subdomain abuse
        parts = hostname.split(".")
        if len(parts) > 4:
            result["score"] += 3
            result["issues"].append("Excessive subdomains")
        
    except Exception as e:
        logger.debug(f"URL structure analysis error: {e}")
    
    return result


def _analyze_content_risks(html: str, text: str) -> dict:
    """
    Analyze page content for suspicious patterns.
    Returns: {suspicious_count, urgency_score, popup_count, fake_badges}
    """
    result = {
        "suspicious_count": 0,
        "urgency_score": 0,
        "popup_count": 0,
        "fake_badges": False,
    }
    
    if not html and not text:
        return result
    
    combined = (html or "").lower() + " " + (text or "").lower()
    
    # Count suspicious keywords
    for keyword in ADVANCED_SUSPICIOUS_KEYWORDS:
        if keyword in combined:
            result["suspicious_count"] += 1
    
    # Check for urgency indicators
    urgency_patterns = [
        r"act\s+now", r"limited\s+time", r"expires\s+soon",
        r"only\s+\d+\s+left", r"hurry", r"urgent",
    ]
    for pattern in urgency_patterns:
        if re.search(pattern, combined, re.IGNORECASE):
            result["urgency_score"] += 2
    
    # Count popup triggers (simplified)
    popup_patterns = [r"onclick.*alert", r"window\.open", r"popup"]
    for pattern in popup_patterns:
        matches = len(re.findall(pattern, html or "", re.IGNORECASE))
        result["popup_count"] += matches
    
    # Check for fake trust badges
    fake_badge_patterns = [
        r"verified.*secure", r"trusted.*site", r"ssl.*certified",
        r"award.*winning", r"best.*service",
    ]
    if any(re.search(p, combined, re.IGNORECASE) for p in fake_badge_patterns):
        result["fake_badges"] = True
    
    return result


def _check_dns_records(domain: str) -> dict:
    """
    Check DNS records for anomalies.
    Returns: {has_mx, has_txt, suspicious_spf, dns_error}
    """
    result = {
        "has_mx": False,
        "has_txt": False,
        "suspicious_spf": False,
        "dns_error": None,
    }
    
    if not dns:
        result["dns_error"] = "DNS library not available"
        return result
    
    try:
        resolver = dns.resolver.Resolver()
        resolver.timeout = 3
        resolver.lifetime = 3
        
        # Check MX records
        try:
            mx_records = resolver.resolve(domain, "MX")
            result["has_mx"] = len(mx_records) > 0
        except:
            pass
        
        # Check TXT records
        try:
            txt_records = resolver.resolve(domain, "TXT")
            result["has_txt"] = len(txt_records) > 0
            # Check for SPF records
            for record in txt_records:
                if "v=spf1" in str(record):
                    result["suspicious_spf"] = False  # SPF is good
                    break
        except:
            pass
    except Exception as e:
        result["dns_error"] = str(e)
    
    return result


def _compute_advanced_risk_score(signals: dict) -> tuple[int, str]:
    """
    Compute risk score (0-100) and level from detection signals.
    """
    score = 0
    
    # Google Safe Browsing flag → +40
    if signals.get("google_flagged"):
        score += 40
    
    # VirusTotal detections → +25 (capped)
    vt_detections = signals.get("virustotal_detections", 0)
    if vt_detections > 0:
        score += min(25, vt_detections * 5)
    
    # Domain age risk → +15
    age_days = signals.get("domain_age_days")
    if age_days is not None:
        if age_days < 90:
            score += 15
        elif age_days < 180:
            score += 8
    
    # SSL issues → +20 (no SSL) or +10 (expired)
    ssl_info = signals.get("ssl_info", {})
    if not ssl_info.get("valid"):
        if signals.get("url_scheme") == "http":
            score += 20
    elif ssl_info.get("expired"):
        score += 10
    
    # Suspicious content → +10
    content_risks = signals.get("content_risks", {})
    if content_risks.get("suspicious_count", 0) > 3:
        score += 10
    elif content_risks.get("urgency_score", 0) > 5:
        score += 8
    
    # URL anomalies → +10
    url_structure = signals.get("url_structure", {})
    score += min(10, url_structure.get("score", 0))
    
    # Missing legal pages → +5
    missing_pages = signals.get("missing_legal_pages", 0)
    score += min(5, missing_pages * 2)
    
    # Clamp to 0-100
    score = max(0, min(100, score))
    
    # Map to risk level
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


@app.route("/detect_fake_advanced", methods=["POST"])
def detect_fake_advanced():
    """
    Advanced Website Intelligence Engine endpoint.
    Uses shared analyzer_service.analyze_website (same engine as compare_apps_advanced).
    Input: { "url": "https://example.com" }
    Output: { url, risk_score, risk_level, signals, recommendation }
    """
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON", "message": "Request body must be valid JSON"}), 400

        url = (data.get("url") or "").strip()
        if not url:
            return jsonify({"error": "Missing url", "message": "Field 'url' is required"}), 400

        if analyzer_analyze_website is None:
            return jsonify({"error": "Analyzer unavailable", "message": "analyzer_service not found"}), 503

        result = analyzer_analyze_website(url)
        if not result.get("success"):
            return jsonify({"error": "Analysis failed", "message": result.get("error", "Invalid URL")}), 400

        url = result.get("url", url)
        risk_score = result.get("risk_score", 0)
        risk_level = result.get("risk_level", "Unknown")
        signals = result.get("signals") or {}

        if risk_score <= 20:
            recommendation = "This website appears safe. Standard precautions apply."
        elif risk_score <= 40:
            recommendation = "Low risk detected. Exercise normal caution."
        elif risk_score <= 60:
            recommendation = "Moderate risk detected. Review carefully before sharing personal information."
        elif risk_score <= 80:
            recommendation = "High risk detected. Avoid entering sensitive data or making payments."
        else:
            recommendation = "Critical risk detected. This website is likely a scam. Do not proceed."

        safety_score = 100 - risk_score
        checks_used = [
            "Domain age (WHOIS)",
            "SSL certificate",
            "URL structure",
            "Page content scan",
            "Legal pages (/privacy, /terms, /contact)",
        ]
        if os.environ.get("GOOGLE_SAFE_BROWSING_API_KEY"):
            checks_used.append("Google Safe Browsing (API)")
        else:
            checks_used.append("Google Safe Browsing (not configured)")
        if os.environ.get("VIRUSTOTAL_API_KEY"):
            checks_used.append("VirusTotal (API)")
        else:
            checks_used.append("VirusTotal (not configured)")

        return jsonify({
            "url": url,
            "risk_score": risk_score,
            "safety_score": safety_score,
            "risk_level": risk_level,
            "signals": signals,
            "recommendation": recommendation,
            "checks_used": checks_used,
        })
    except Exception as e:
        logger.exception("detect_fake_advanced failed")
        return jsonify({"error": "Server error", "message": str(e)}), 500


# ---------------------------------------------------------------------------
# Reusable analyzer (same engine as Fake Website Detection)
# ---------------------------------------------------------------------------
try:
    from analyzer_service import analyze_website as analyzer_analyze_website
except ImportError:
    analyzer_analyze_website = None

# ---------------------------------------------------------------------------
# App-to-App Comparison (independent module)
# ---------------------------------------------------------------------------
try:
    from comparison_engine import run_comparison, get_domain_for_url, get_apps_in_domain
except ImportError:
    run_comparison = None
    get_domain_for_url = None
    get_apps_in_domain = None


def _build_compare_signals(signals: dict | None) -> dict:
    """Build response signals object for compare_apps_advanced (normalized keys)."""
    if not signals:
        return {
            "domain_age_days": None,
            "ssl_valid": False,
            "google_flagged": False,
            "virustotal_detections": 0,
            "suspicious_keywords": 0,
            "missing_legal_pages": 0,
        }
    return {
        "domain_age_days": signals.get("domain_age_days"),
        "ssl_valid": signals.get("ssl_valid", False),
        "google_flagged": signals.get("google_flagged", False),
        "virustotal_detections": signals.get("virustotal_detections", 0),
        "suspicious_keywords": signals.get("suspicious_keywords_found", 0),
        "missing_legal_pages": signals.get("missing_legal_pages", 0),
    }


@app.route("/compare_apps_advanced", methods=["POST"])
def compare_apps_advanced():
    """
    App-to-App comparison using the same advanced detection engine as Fake Website Detection.
    Input: { "apps": [ {"name": "Facebook", "url": "https://facebook.com"}, ... ] }
    Optional: { "url": "<primary_url>" } — if apps not provided, resolves apps from domain.
    Output: ranking (sorted lowest risk first), most_secure, highest_risk.
    """
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON", "message": "Request body must be valid JSON"}), 400

        apps = data.get("apps")
        if not apps and data.get("url"):
            primary = (data.get("url") or "").strip()
            if primary and get_domain_for_url and get_apps_in_domain:
                domain_name = get_domain_for_url(primary)
                apps = get_apps_in_domain(domain_name, include_primary_url=primary)
        if not apps:
            return jsonify({"error": "Missing apps", "message": "Field 'apps' (array of {name, url}) or 'url' is required"}), 400

        if analyzer_analyze_website is None:
            return jsonify({"error": "Analyzer unavailable", "message": "analyzer_service module not found"}), 503

        results = []
        for entry in apps:
            name = entry.get("name") or "Unknown"
            url = (entry.get("url") or "").strip()
            if not url:
                results.append({
                    "name": name,
                    "url": "",
                    "risk_score": 100,
                    "risk_level": "Error",
                    "signals": _build_compare_signals(None),
                    "error": "Missing URL",
                })
                continue
            r = analyzer_analyze_website(url)
            if r.get("success"):
                results.append({
                    "name": name,
                    "url": r.get("url", url),
                    "risk_score": r.get("risk_score", 0),
                    "risk_level": r.get("risk_level", "Unknown"),
                    "signals": _build_compare_signals(r.get("signals")),
                })
            else:
                results.append({
                    "name": name,
                    "url": url,
                    "risk_score": 100,
                    "risk_level": "Error",
                    "signals": _build_compare_signals(None),
                    "error": r.get("error", "Analysis failed"),
                })

        results.sort(key=lambda x: (x["risk_score"], x["name"]))
        for i, row in enumerate(results, 1):
            row["rank"] = i

        most_secure = results[0]["name"] if results else ""
        highest_risk = results[-1]["name"] if results else ""

        return jsonify({
            "ranking": results,
            "most_secure": most_secure,
            "highest_risk": highest_risk,
        })
    except Exception as e:
        logger.exception("compare_apps_advanced failed")
        return jsonify({"error": "Server error", "message": str(e)}), 500


@app.route("/compare_apps", methods=["POST"])
def compare_apps():
    """
    App-to-App comparison endpoint: compare one app URL against predefined competitors in the same domain.
    Input: { "url": "<primary_app_url>" }
    Output: input_url, domain, comparison_results (app, url, risk_score, status, ssl, legal_pages_missing,
            suspicious_keywords_count, domain_age_months), recommended_app (safest).
    """
    try:
        data = request.get_json()
        if data is None:
            return jsonify({"error": "Invalid JSON", "message": "Request body must be valid JSON"}), 400

        url = (data.get("url") or "").strip()
        if not url:
            return jsonify({"error": "Missing url", "message": "Field 'url' is required"}), 400

        if run_comparison is None:
            return jsonify({
                "error": "Comparison engine unavailable",
                "message": "comparison_engine module not found",
            }), 503

        result = run_comparison(url)
        return jsonify(result)

    except Exception as e:
        logger.exception("compare_apps failed")
        return jsonify({"error": "Server error", "message": str(e)}), 500


@app.route("/analyze", methods=["POST"])
def analyze():
    try:
        data = request.get_json()
        if data is None:
            return jsonify({
                "error": "Invalid JSON",
                "message": "Request body must be valid JSON",
            }), 400

        text = data.get("text", "")

        if text is None:
            return jsonify({
                "error": "Missing text",
                "message": "Field 'text' is required",
            }), 400

        if not str(text).strip():
            return jsonify({
                "error": "Empty text",
                "message": "Field 'text' cannot be empty",
            }), 400

        text = str(text).strip()
        
        # Analyze risks and generate user-friendly output
        risk_analysis = analyze_legal_risks(text)

        return jsonify(risk_analysis)

    except Exception as e:
        logger.exception("Analyze route failed")
        return jsonify({
            "error": "Server error",
            "message": str(e),
        }), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
