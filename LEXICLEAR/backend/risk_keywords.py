"""
LexiClear - Risk Keyword Module
Category + risk detection using keyword-based rules.
"""

# ---------------------------------------------------------------------------
# 1. Clause Categories & Keywords
# ---------------------------------------------------------------------------
CATEGORY_KEYWORDS = {
    "Data": ["data", "personal information", "privacy", "collect", "share"],
    "Financial": ["payment", "charge", "refund", "fee", "tax"],
    "Termination": ["terminate", "suspend", "cancel", "deactivate", "close account"],
    "Arbitration": ["arbitration", "dispute", "court", "jurisdiction", "waive rights"],
    "Ownership": ["ownership", "license", "copyright", "intellectual property", "rights"],
}

# ---------------------------------------------------------------------------
# 2. Risk Keywords & Scoring
# ---------------------------------------------------------------------------
HIGH_RISK_KEYWORDS = [
    "irrevocable",
    "perpetual",
    "sole discretion",
    "without notice",
    "waive rights",
]

MEDIUM_RISK_KEYWORDS = [
    "limited",
    "may",
    "conditional",
    "subject to",
    "at discretion",
]

RISK_SCORES = {"Low": 2, "Medium": 5, "High": 8}


def _get_category(clause: str) -> str:
    """Return first matching category, else 'Other'."""
    clause_lower = clause.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in clause_lower:
                return category
    return "Other"


def _get_risk_level(clause: str) -> str:
    """Return High, Medium, or Low based on risk keywords."""
    clause_lower = clause.lower()
    for kw in HIGH_RISK_KEYWORDS:
        if kw in clause_lower:
            return "High"
    for kw in MEDIUM_RISK_KEYWORDS:
        if kw in clause_lower:
            return "Medium"
    return "Low"


def analyze_clause(clause_text: str) -> dict:
    """
    Analyze clause: category (first match) + risk level (High/Medium/Low).
    Returns: {clause, category, risk_level, risk_score, source}
    """
    if not clause_text or not isinstance(clause_text, str):
        return {
            "clause": str(clause_text) if clause_text else "",
            "category": "Other",
            "risk_level": "Low",
            "risk_score": RISK_SCORES["Low"],
            "source": "keyword_based",
        }

    clause = clause_text.strip()
    category = _get_category(clause)
    risk_level = _get_risk_level(clause)

    return {
        "clause": clause,
        "category": category,
        "risk_level": risk_level,
        "risk_score": RISK_SCORES[risk_level],
        "source": "keyword_based",
    }
