/**
 * LexiClear Premium - Popup Script
 * Modern, modular architecture with premium UI integration
 * Maintains all backend logic while providing enhanced UX
 */

// ============================================
// CONFIGURATION & CONSTANTS
// ============================================

const API_BASE = 'http://localhost:5000';
const API_ENDPOINT = `${API_BASE}/analyze`;
const CHECK_FAKE_ENDPOINT = `${API_BASE}/check_fake`;
const DETECT_FAKE_ADVANCED_ENDPOINT = `${API_BASE}/detect_fake_advanced`;
const COMPARE_APPS_ENDPOINT = `${API_BASE}/compare_apps`;
const COMPARE_APPS_ADVANCED_ENDPOINT = `${API_BASE}/compare_apps_advanced`;

// ============================================
// DOM ELEMENTS
// ============================================

// Tab Navigation
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// Fake Detection
const fakeUrlInput = document.getElementById('fakeUrlInput');
const useCurrentUrlBtn = document.getElementById('useCurrentUrlBtn');
const checkFakeBtn = document.getElementById('checkFakeBtn');
const fakeStatus = document.getElementById('fakeStatus');
const fakeResult = document.getElementById('fakeResult');
const fakeScoreValue = document.getElementById('fakeScoreValue');
const fakeStatusBadge = document.getElementById('fakeStatusBadge');
const fakeBreakdownToggle = document.getElementById('fakeBreakdownToggle');
const fakeBreakdown = document.getElementById('fakeBreakdown');
const domainAgeRisk = document.getElementById('domainAgeRisk');
const sslRisk = document.getElementById('sslRisk');
const keywordRisk = document.getElementById('keywordRisk');
const missingPagesRisk = document.getElementById('missingPagesRisk');

// App Comparison
const comparePrimaryUrl = document.getElementById('comparePrimaryUrl');
const compareUseCurrentBtn = document.getElementById('compareUseCurrentBtn');
const compareAppsBtn = document.getElementById('compareAppsBtn');
const compareStatus = document.getElementById('compareStatus');
const compareResult = document.getElementById('compareResult');
const compareRecommended = document.getElementById('compareRecommended');
const compareTableBody = document.getElementById('compareTableBody');

// Legal Risk Analyzer
const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const outputPreview = document.getElementById('outputPreview');
const legalSummary = document.getElementById('legalSummary');
const categoryCards = document.getElementById('categoryCards');

// ============================================
// TAB NAVIGATION SYSTEM
// ============================================

function initTabNavigation() {
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      
      // Update buttons
      tabButtons.forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      
      // Update panels
      tabPanels.forEach((panel) => {
        panel.classList.remove('active');
      });
      const targetPanel = document.getElementById(`panel-${targetTab}`);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Ensures content script is injected and sends a message with retry
 */
async function sendMessageWithRetry(tabId, message, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) return response;
    } catch (err) {
      const errMsg = err?.message || '';
      const isConnectionError = errMsg.includes('Receiving end does not exist') || 
                                errMsg.includes('Could not establish connection') ||
                                errMsg.includes('Extension context invalidated');
      
      if (isConnectionError && i < retries) {
        try {
          if (chrome.scripting && chrome.scripting.executeScript) {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content.js'],
            });
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
        } catch (injectErr) {
          const injectMsg = injectErr?.message || '';
          if (injectMsg.includes('Cannot access') || injectMsg.includes('Cannot inject')) {
            throw new Error('This page cannot be analyzed. It may be restricted or not fully loaded. Try reloading the page.');
          }
          if (i < retries) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
        }
      }
      if (i === retries) {
        if (isConnectionError) {
          throw new Error('Content script not available. Please reload the page and try again.');
        }
        throw err;
      }
    }
  }
  throw new Error('Failed to communicate with content script');
}

/**
 * Animate number counting
 * @param {boolean} asInteger - if true, display as integer (e.g. 95 not 95.0)
 */
function animateNumber(element, target, duration = 1000, asInteger = false) {
  const start = 0;
  const increment = target / (duration / 16);
  let current = start;
  const fmt = asInteger ? (n) => Math.round(n).toString() : (n) => n.toFixed(1);
  
  const timer = setInterval(() => {
    current += increment;
    if (current >= target) {
      element.textContent = fmt(target);
      clearInterval(timer);
    } else {
      element.textContent = fmt(current);
    }
  }, 16);
}

/**
 * Update button loading state
 */
function setButtonLoading(button, isLoading) {
  const btnText = button.querySelector('.btn-text');
  const btnLoader = button.querySelector('.btn-loader');
  
  if (isLoading) {
    button.disabled = true;
    btnText.style.opacity = '0.5';
    btnLoader.style.display = 'block';
  } else {
    button.disabled = false;
    btnText.style.opacity = '1';
    btnLoader.style.display = 'none';
  }
}

/**
 * Update status message
 */
function setStatus(element, message, type = '') {
  element.textContent = message;
  element.className = `status-message ${type}`.trim();
}

// ============================================
// FAKE WEBSITE DETECTION
// ============================================

async function useCurrentPageUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
      fakeUrlInput.value = tab.url;
      setStatus(fakeStatus, 'URL filled from current page.', 'success');
    } else {
      setStatus(fakeStatus, 'Cannot use this page. Open a regular website.', 'error');
    }
  } catch (err) {
    setStatus(fakeStatus, err?.message || 'Failed to get URL.', 'error');
  }
}

async function resolveCheckFakeUrl() {
  const raw = (fakeUrlInput.value || '').trim();
  if (raw && raw.toLowerCase() !== 'current') return raw;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
    return tab.url;
  }
  return null;
}

function updateRiskMeter(safetyScore, riskLevel) {
  const meter = document.querySelector('.risk-meter');
  const progress = document.querySelector('.risk-progress');
  const circumference = 2 * Math.PI * 54; // radius = 54
  // safetyScore is 0-100 (higher = safer). Fill circle by safety %
  const offset = circumference - (safetyScore / 100) * circumference;
  
  // Remove existing classes
  meter.classList.remove('safe', 'warning', 'danger');
  
  // Set color and badge based on risk level
  const levelLower = (riskLevel || '').toLowerCase();
  if (levelLower.includes('safe') || levelLower.includes('low risk')) {
    meter.classList.add('safe');
    fakeStatusBadge.textContent = riskLevel || 'Safe';
    fakeStatusBadge.className = 'status-badge safe';
  } else if (levelLower.includes('moderate')) {
    meter.classList.add('warning');
    fakeStatusBadge.textContent = riskLevel || 'Moderate Risk';
    fakeStatusBadge.className = 'status-badge warning';
  } else if (levelLower.includes('high') || levelLower.includes('critical') || levelLower.includes('scam')) {
    meter.classList.add('danger');
    fakeStatusBadge.textContent = riskLevel || 'High Risk';
    fakeStatusBadge.className = 'status-badge danger';
  } else {
    // Fallback to safety score
    if (safetyScore >= 80) {
      meter.classList.add('safe');
      fakeStatusBadge.textContent = 'Safe';
      fakeStatusBadge.className = 'status-badge safe';
    } else if (safetyScore >= 40) {
      meter.classList.add('warning');
      fakeStatusBadge.textContent = 'Moderate Risk';
      fakeStatusBadge.className = 'status-badge warning';
    } else {
      meter.classList.add('danger');
      fakeStatusBadge.textContent = 'High Risk';
      fakeStatusBadge.className = 'status-badge danger';
    }
  }
  
  // Animate progress
  setTimeout(() => {
    progress.style.strokeDashoffset = offset;
  }, 100);
  
  // Animate safety score (0-100, integer)
  animateNumber(fakeScoreValue, safetyScore, 800, true);
}

async function handleCheckFake() {
  fakeResult.style.display = 'none';
  setStatus(fakeStatus, 'Resolving URL...', 'loading');
  setButtonLoading(checkFakeBtn, true);

  let url;
  try {
    url = await resolveCheckFakeUrl();
  } catch (e) {
    setStatus(fakeStatus, 'Could not get current page URL.', 'error');
    setButtonLoading(checkFakeBtn, false);
    return;
  }

  if (!url) {
    setStatus(fakeStatus, 'Enter a URL or open a regular website and use "Use Current Page URL".', 'error');
    setButtonLoading(checkFakeBtn, false);
    return;
  }

  setStatus(fakeStatus, 'Running multi-layered analysis...', 'loading');
  
  try {
    // Use advanced endpoint
    const response = await fetch(DETECT_FAKE_ADVANCED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!response.ok) {
      throw new Error(data?.message || `Server error (${response.status})`);
    }

    const riskScore = data.risk_score ?? 0;
    const safetyScore = data.safety_score ?? (100 - riskScore);
    const riskLevel = data.risk_level ?? 'Unknown';
    const signals = data.signals || {};
    const recommendation = data.recommendation || '';
    const checksUsed = data.checks_used || [];

    // Update risk meter: show safety score (0-100, higher = safer)
    updateRiskMeter(safetyScore, riskLevel);

    // Show what checks were used so user knows how "Safe" was determined
    const checksEl = document.getElementById('checksUsed');
    if (checksEl && checksUsed.length) {
      const apiUsed = checksUsed.some(c => c.includes('(API)'));
      checksEl.textContent = apiUsed
        ? 'Verified with: domain, SSL, content, Google Safe Browsing & VirusTotal.'
        : 'Based on: domain age, SSL, URL structure, content scan, legal pages. Add API keys for Google & VirusTotal for stronger verification.';
      checksEl.style.display = 'block';
    }
    
    // Update breakdown with advanced signals
    const ageDays = signals.domain_age_days;
    if (ageDays !== null && ageDays !== undefined) {
      domainAgeRisk.textContent = ageDays < 90 ? 'High' : ageDays < 180 ? 'Moderate' : 'Low';
    } else {
      domainAgeRisk.textContent = 'Unknown';
    }
    
    sslRisk.textContent = signals.ssl_valid ? 'Valid' : (signals.ssl_expired ? 'Expired' : 'None');
    keywordRisk.textContent = signals.suspicious_keywords_found ?? 0;
    missingPagesRisk.textContent = signals.missing_legal_pages ?? 0;

    // Show Google Safe Browsing if checked
    const googleItem = document.getElementById('googleSafeBrowsingItem');
    const googleValue = document.getElementById('googleSafeBrowsing');
    if (signals.google_flagged !== undefined) {
      googleItem.style.display = 'flex';
      googleValue.textContent = signals.google_flagged ? '⚠ Flagged' : '✓ Clean';
      googleValue.style.color = signals.google_flagged ? 'var(--danger)' : 'var(--safe)';
    }

    // Show VirusTotal if checked
    const vtItem = document.getElementById('virustotalItem');
    const vtValue = document.getElementById('virustotalDetections');
    if (signals.virustotal_detections !== undefined) {
      vtItem.style.display = 'flex';
      const detections = signals.virustotal_detections ?? 0;
      vtValue.textContent = detections > 0 ? `${detections} engines` : 'Clean';
      vtValue.style.color = detections > 0 ? 'var(--danger)' : 'var(--safe)';
    }

    // Update recommendation
    const recommendationSection = document.getElementById('recommendationSection');
    const recommendationText = document.getElementById('recommendationText');
    if (recommendation) {
      recommendationSection.style.display = 'block';
      recommendationText.textContent = recommendation;
    }

    // Show result
    fakeResult.style.display = 'block';
    setStatus(fakeStatus, 'Analysis complete.', 'success');
    saveActivityToHistory('fake', url, { score: safetyScore, level: riskLevel });
  } catch (err) {
    const msg = err?.message || 'Check failed.';
    setStatus(fakeStatus, msg.includes('fetch') ? 'Backend unreachable. Start the Flask server.' : msg, 'error');
  } finally {
    setButtonLoading(checkFakeBtn, false);
  }
}

// Breakdown toggle
fakeBreakdownToggle.addEventListener('click', () => {
  const isActive = fakeBreakdownToggle.classList.toggle('active');
  fakeBreakdown.style.display = isActive ? 'block' : 'none';
});

// ============================================
// APP COMPARISON
// ============================================

async function useCurrentPageForCompare() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
      comparePrimaryUrl.value = tab.url;
      setStatus(compareStatus, 'URL filled from current page.', 'success');
    } else {
      setStatus(compareStatus, 'Cannot use this page. Open a regular website.', 'error');
    }
  } catch (err) {
    setStatus(compareStatus, err?.message || 'Failed to get URL.', 'error');
  }
}

function getRiskLevelClass(riskLevel) {
  if (!riskLevel) return 'high';
  if (riskLevel.includes('Safe')) return 'safe';
  if (riskLevel.includes('Low')) return 'safe';
  if (riskLevel.includes('Moderate')) return 'moderate';
  return 'high';
}

function renderCompareResult(data) {
  compareResult.style.display = 'block';
  compareTableBody.innerHTML = '';

  const ranking = data.ranking || [];
  const mostSecure = data.most_secure || '';
  const highestRisk = data.highest_risk || '';

  if (mostSecure) {
    compareRecommended.style.display = 'block';
    compareRecommended.textContent = `✓ Recommended: ${mostSecure}`;
  } else {
    compareRecommended.style.display = 'none';
  }

  ranking.forEach((item) => {
    const rank = item.rank ?? 0;
    const name = item.name || 'Unknown';
    const url = item.url || '';
    const riskScore = item.risk_score != null ? item.risk_score : 100;
    const riskLevel = item.risk_level || 'Unknown';
    const signals = item.signals || {};
    const statusClass = getRiskLevelClass(riskLevel);
    const isMostSecure = name === mostSecure;
    const isHighestRisk = name === highestRisk;

    const row = document.createElement('tr');
    row.className = 'compare-app-row';
    if (isMostSecure) row.classList.add('most-secure');
    if (isHighestRisk) row.classList.add('highest-risk');
    row.setAttribute('data-rank', rank);

    const riskPct = Math.min(100, Math.round(riskScore));
    const meterClass = statusClass === 'safe' ? 'safe' : statusClass === 'moderate' ? 'moderate' : 'high';
    row.innerHTML = `
      <td class="compare-rank"><span class="rank-badge">#${rank}</span></td>
      <td class="compare-app-name">
        <strong>${escapeHtml(name)}</strong>
        <br><small class="compare-url">${escapeHtml(url)}</small>
      </td>
      <td class="compare-risk-cell">
        <div class="risk-meter-wrap" title="Risk score 0–100">
          <div class="risk-meter-fill risk-meter-${meterClass}" style="width: ${riskPct}%"></div>
        </div>
        <span class="compare-risk-value">${riskScore}</span>
      </td>
      <td><span class="table-status ${statusClass}">${escapeHtml(riskLevel)}</span></td>
      <td class="compare-expand-cell">
        <button type="button" class="compare-expand-btn" aria-expanded="false" title="Show technical details">
          <svg class="expand-icon" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </td>
    `;

    const expandBtn = row.querySelector('.compare-expand-btn');
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'compare-details-row';
    detailsRow.hidden = true;
    const errorMsg = item.error ? `<p class="compare-details-error">${escapeHtml(item.error)}</p>` : '';
    const sslVal = signals.ssl_valid ? '✓ Yes' : '✗ No';
    const sslClass = signals.ssl_valid ? 'signal-ok' : 'signal-bad';
    const gsbVal = signals.google_flagged ? 'Flagged' : 'OK';
    const gsbClass = signals.google_flagged ? 'signal-bad' : 'signal-ok';
    const vt = signals.virustotal_detections ?? '—';
    const vtClass = (typeof vt === 'number' && vt > 0) ? 'signal-bad' : '';
    detailsRow.innerHTML = `
      <td colspan="5" class="compare-details-cell">
        ${errorMsg}
        <div class="compare-signals-title">Technical signals</div>
        <div class="compare-signals">
          <div class="signal"><span class="signal-label">Domain age (days)</span><span class="signal-value">${signals.domain_age_days != null ? signals.domain_age_days : '—'}</span></div>
          <div class="signal"><span class="signal-label">SSL valid</span><span class="signal-value ${sslClass}">${sslVal}</span></div>
          <div class="signal"><span class="signal-label">Google Safe Browsing</span><span class="signal-value ${gsbClass}">${gsbVal}</span></div>
          <div class="signal"><span class="signal-label">VirusTotal detections</span><span class="signal-value ${vtClass}">${vt}</span></div>
          <div class="signal"><span class="signal-label">Suspicious keywords</span><span class="signal-value">${signals.suspicious_keywords ?? '—'}</span></div>
          <div class="signal"><span class="signal-label">Missing legal pages</span><span class="signal-value">${signals.missing_legal_pages ?? '—'}</span></div>
        </div>
      </td>
    `;

    expandBtn.addEventListener('click', () => {
      const expanded = expandBtn.getAttribute('aria-expanded') === 'true';
      expandBtn.setAttribute('aria-expanded', !expanded);
      detailsRow.hidden = expanded;
      row.querySelector('.expand-icon').style.transform = expanded ? '' : 'rotate(-180deg)';
    });

    compareTableBody.appendChild(row);
    compareTableBody.appendChild(detailsRow);
  });
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function handleCompareApps() {
  let primary = (comparePrimaryUrl.value || '').trim();
  if (!primary) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
        primary = tab.url;
      }
    } catch (_) {}
  }

  if (!primary) {
    setStatus(compareStatus, 'Enter a primary app URL or open a website and try again.', 'error');
    return;
  }

  compareResult.style.display = 'none';
  setStatus(compareStatus, 'Running advanced security analysis…', 'loading');
  setButtonLoading(compareAppsBtn, true);

  try {
    const response = await fetch(COMPARE_APPS_ADVANCED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: primary }),
    });

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!response.ok) {
      throw new Error(data?.message || `Server error (${response.status})`);
    }

    renderCompareResult(data);
    setStatus(compareStatus, 'Comparison complete.', 'success');
    const summary = data.most_secure ? { level: `Best: ${data.most_secure}`, count: (data.ranking || []).length } : { count: (data.ranking || []).length };
    saveActivityToHistory('compare', primary, summary);
  } catch (err) {
    const msg = err?.message || 'Comparison failed.';
    setStatus(compareStatus, msg.includes('fetch') ? 'Backend unreachable. Start the Flask server.' : msg, 'error');
  } finally {
    setButtonLoading(compareAppsBtn, false);
  }
}

// ============================================
// LEGAL RISK ANALYZER
// ============================================

async function extractPageText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active tab found');
  }

  if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
    throw new Error('Cannot analyze browser internal pages');
  }

  if (tab.status !== 'complete') {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const response = await sendMessageWithRetry(tab.id, { action: 'EXTRACT_PAGE_TEXT' });

  if (!response?.success) {
    throw new Error(response?.error || 'Failed to extract page text');
  }

  return {
    text: response.text ?? '',
    url: tab.url ?? '',
  };
}

async function sendToBackend(text, url) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, url }),
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Backend error (${response.status}): ${raw || response.statusText}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON response from backend');
  }
}

function displayAnalysisResult(data) {
  const riskScore = data?.risk_score ?? 0;
  const riskLevel = data?.risk_level ?? 'Moderate Risk';
  const pros = data?.pros ?? [];
  const cons = data?.cons ?? [];
  const summary = data?.summary || 'Analysis complete.';
  
  outputPreview.style.display = 'block';
  
  // Update risk score circle
  const scoreCircle = document.querySelector('.risk-score-circle');
  const scoreProgress = document.querySelector('.risk-score-progress');
  const scoreValue = document.getElementById('legalRiskScore');
  const riskBadge = document.getElementById('legalRiskBadge');
  const prosList = document.getElementById('legalPros');
  const consList = document.getElementById('legalCons');
  const summaryEl = document.getElementById('legalSummary');
  
  // Remove existing classes
  scoreCircle.classList.remove('safe', 'moderate', 'high');
  riskBadge.classList.remove('safe', 'moderate', 'high');
  
  // Determine risk level class
  let riskClass = 'moderate';
  if (riskScore <= 30) {
    riskClass = 'safe';
  } else if (riskScore > 60) {
    riskClass = 'high';
  }
  
  scoreCircle.classList.add(riskClass);
  riskBadge.classList.add(riskClass);
  
  // Animate score
  animateNumber(scoreValue, riskScore, 1000);
  riskBadge.textContent = riskLevel;
  
  // Animate progress circle
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (riskScore / 100) * circumference;
  setTimeout(() => {
    scoreProgress.style.strokeDashoffset = offset;
  }, 100);
  
  // Populate pros
  prosList.innerHTML = '';
  if (pros.length > 0) {
    pros.forEach((pro) => {
      const li = document.createElement('li');
      li.textContent = pro;
      prosList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No positive points found';
    li.style.color = 'var(--text-tertiary)';
    li.style.fontStyle = 'italic';
    prosList.appendChild(li);
  }
  
  // Populate cons
  consList.innerHTML = '';
  if (cons.length > 0) {
    cons.forEach((con) => {
      const li = document.createElement('li');
      li.textContent = con;
      consList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'No concerns found';
    li.style.color = 'var(--text-tertiary)';
    li.style.fontStyle = 'italic';
    consList.appendChild(li);
  }
  
  // Update summary
  summaryEl.textContent = summary;
}

async function handleAnalyze() {
  outputPreview.style.display = 'none';
  setStatus(statusEl, 'Extracting page content...', 'loading');
  setButtonLoading(analyzeBtn, true);

  try {
    const { text, url } = await extractPageText();
    setStatus(statusEl, 'Analyzing with backend...', 'loading');
    const data = await sendToBackend(text, url);
    displayAnalysisResult(data);
    setStatus(statusEl, data?.classified_clauses?.length ? 'Analysis complete.' : 'Analysis finished (no clauses found).', 'success');
    const riskScore = data?.risk_score ?? 0;
    const riskLevel = data?.risk_level ?? 'Moderate Risk';
    saveActivityToHistory('legal', url, { score: riskScore, level: riskLevel });
  } catch (err) {
    let message = err?.message || 'An unexpected error occurred';
    if (message.includes('Receiving end does not exist') || message.includes('Could not establish connection')) {
      message = 'Cannot analyze this page. Try a regular website (e.g. wikipedia.org).';
    } else if (err?.name === 'TypeError' && message.includes('fetch')) {
      message = 'Backend unreachable. Ensure the server is running at http://localhost:5000';
    }
    setStatus(statusEl, message, 'error');
  } finally {
    setButtonLoading(analyzeBtn, false);
  }
}

// ============================================
// SETTINGS PANEL & HISTORY
// ============================================

/** Always save to chrome.storage.local so history persists even if settings module loads late. */
function saveActivityToHistory(type, input, resultSummary) {
  const item = {
    id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
    type: type,
    input: input,
    result_summary: resultSummary || {},
    timestamp: new Date().toISOString(),
  };
  chrome.storage.local.get(['history'], (data) => {
    const list = Array.isArray(data.history) ? data.history : [];
    const next = [item].concat(list).slice(0, 100);
    chrome.storage.local.set({ history: next }, () => {
      if (typeof updateSettingsBadgeFromHistory === 'function') updateSettingsBadgeFromHistory();
    });
  });
}

/** Load history from storage (used when settings module may not be ready). */
function loadHistoryFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['history'], (data) => {
      resolve(Array.isArray(data.history) ? data.history : []);
    });
  });
}

const settingsBtn = document.getElementById('settingsBtn');
const settingsBadge = document.getElementById('settingsBadge');
const settingsPanel = document.getElementById('settingsPanel');
const settingsBackdrop = document.getElementById('settingsBackdrop');
const settingsClose = document.getElementById('settingsClose');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const exportHistoryBtn = document.getElementById('exportHistoryBtn');
const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');

function getRiskBadgeClass(level) {
  if (!level) return 'moderate';
  const l = String(level).toLowerCase();
  if (l.includes('safe') || l.includes('low')) return 'safe';
  if (l.includes('moderate') || l.includes('warning')) return 'moderate';
  return 'high';
}

/** Human-friendly time like Chrome/Google history: "Today 3:42 PM", "Yesterday", "22 Feb" */
function formatHistoryTimestamp(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (d >= today) return `Today ${timeStr}`;
    if (d >= yesterday) return `Yesterday ${timeStr}`;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch (_) {
    return '';
  }
}

/** Extract hostname for a cleaner display (e.g. "example.com") */
function getDisplayUrl(input) {
  if (!input || typeof input !== 'string') return input || '';
  try {
    const u = new URL(input.startsWith('http') ? input : 'https://' + input);
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return truncate(input, 45);
  }
}

function renderHistoryItem(item, typeLabel) {
  const summary = item.result_summary || {};
  const level = summary.level || (summary.score != null ? `Score ${summary.score}` : '');
  const badgeClass = getRiskBadgeClass(level);
  const displayUrl = getDisplayUrl(item.input);
  const fullUrl = item.input || '';
  const timeStr = formatHistoryTimestamp(item.timestamp);
  const li = document.createElement('li');
  li.className = 'history-item';
  li.setAttribute('role', 'listitem');
  li.setAttribute('data-id', item.id);
  li.setAttribute('data-type', item.type);
  li.setAttribute('data-input', fullUrl);
  li.innerHTML = `
    <span class="history-item-icon" aria-hidden="true">${getHistoryTypeIcon(item.type)}</span>
    <div class="history-item-content">
      <div class="history-item-url" title="${escapeHtml(fullUrl)}">${escapeHtml(displayUrl)}</div>
      <div class="history-item-meta">
        <span class="history-item-type-label">${escapeHtml(typeLabel)}</span>
        <span class="history-item-dot" aria-hidden="true">·</span>
        <span class="history-item-badge ${badgeClass}">${escapeHtml(level || '—')}</span>
        <span class="history-item-dot" aria-hidden="true">·</span>
        <span class="history-item-time">${timeStr}</span>
      </div>
    </div>
    <button type="button" class="history-item-delete" title="Remove from history" aria-label="Remove from history" data-id="${item.id}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"/></svg>
    </button>
  `;
  li.querySelector('.history-item-content').addEventListener('click', () => openHistoryItem(item));
  li.querySelector('.history-item-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    removeHistoryItem(item.id);
  });
  return li;
}

function getHistoryTypeIcon(type) {
  const icons = {
    fake: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    compare: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M8 3H3v5M12 22v-8M4 12l4 4 4-4M20 12l-4 4-4-4M12 2v4"/></svg>',
    legal: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  };
  return icons[type] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
}

function renderHistoryList(items) {
  if (!historyList || !historyEmpty) return;
  historyList.innerHTML = '';
  if (!items || items.length === 0) {
    historyEmpty.classList.remove('hidden');
    return;
  }
  historyEmpty.classList.add('hidden');
  const typeLabels = { fake: 'Fake Detection', compare: 'Compare', legal: 'Legal Risk' };
  const order = ['fake', 'compare', 'legal'];
  const byType = { fake: [], compare: [], legal: [] };
  items.forEach((item) => {
    if (byType[item.type]) byType[item.type].push(item);
  });
  order.forEach((type) => {
    const group = byType[type] || [];
    group.forEach((item) => {
      historyList.appendChild(renderHistoryItem(item, typeLabels[item.type] || type));
    });
  });
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max) + '…';
}

function openHistoryItem(item) {
  const type = item.type;
  const input = item.input || '';
  tabButtons.forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  tabPanels.forEach((p) => p.classList.remove('active'));
  const btn = document.querySelector(`.tab-btn[data-tab="${type}"]`);
  const panel = document.getElementById(`panel-${type}`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }
  if (panel) panel.classList.add('active');
  if (type === 'fake' && fakeUrlInput) fakeUrlInput.value = input;
  if (type === 'compare' && comparePrimaryUrl) comparePrimaryUrl.value = input;
  closeSettingsPanel();
}

function removeHistoryItem(id) {
  const deleteFn = typeof LexiClearSettings !== 'undefined' && LexiClearSettings.deleteHistoryItem
    ? LexiClearSettings.deleteHistoryItem(id)
    : loadHistoryFromStorage().then((list) => {
        const next = list.filter((item) => item.id !== id);
        return new Promise((res) => chrome.storage.local.set({ history: next }, () => res(next)));
      });
  deleteFn.then(() => {
    refreshHistoryUI();
    if (typeof LexiClearSettings !== 'undefined' && LexiClearSettings.showToast) LexiClearSettings.showToast('Entry removed');
  });
}

function refreshHistoryUI() {
  const load = typeof LexiClearSettings !== 'undefined' && LexiClearSettings.loadHistory
    ? LexiClearSettings.loadHistory()
    : loadHistoryFromStorage();
  load.then((items) => {
    renderHistoryList(items);
    updateSettingsBadge(items.length);
  });
}

function updateSettingsBadge(count) {
  if (!settingsBadge) return;
  if (count > 0) {
    settingsBadge.textContent = count > 99 ? '99+' : String(count);
    settingsBadge.classList.add('visible');
  } else {
    settingsBadge.textContent = '0';
    settingsBadge.classList.remove('visible');
  }
}

function updateSettingsBadgeFromHistory() {
  const load = typeof LexiClearSettings !== 'undefined' && LexiClearSettings.loadHistory
    ? LexiClearSettings.loadHistory()
    : loadHistoryFromStorage();
  load.then((items) => updateSettingsBadge(items.length));
}

function openSettingsPanel() {
  settingsPanel.classList.add('visible');
  settingsBackdrop.classList.add('visible');
  settingsBackdrop.setAttribute('aria-hidden', 'false');
  settingsPanel.setAttribute('aria-hidden', 'false');
  refreshHistoryUI();
  syncThemeRadios();
}

function closeSettingsPanel() {
  settingsPanel.classList.remove('visible');
  settingsBackdrop.classList.remove('visible');
  settingsBackdrop.setAttribute('aria-hidden', 'true');
  settingsPanel.setAttribute('aria-hidden', 'true');
}

function syncThemeRadios() {
  const getTheme = typeof LexiClearSettings !== 'undefined' && LexiClearSettings.getTheme
    ? LexiClearSettings.getTheme()
    : new Promise((resolve) => {
        chrome.storage.local.get(['theme'], (d) => resolve(d.theme || 'system'));
      });
  getTheme.then((value) => {
    const radio = document.querySelector(`input[name="theme"][value="${value}"]`);
    if (radio) radio.checked = true;
  });
}

function initSettingsUI() {
  if (!settingsBtn || !settingsPanel) return;
  if (typeof LexiClearSettings !== 'undefined') LexiClearSettings.loadStoredTheme();
  loadHistoryFromStorage().then((items) => updateSettingsBadge(items.length));

  settingsBtn.addEventListener('click', openSettingsPanel);
  settingsClose.addEventListener('click', closeSettingsPanel);
  settingsBackdrop.addEventListener('click', closeSettingsPanel);

  document.querySelectorAll('input[name="theme"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const value = radio.value;
      if (typeof LexiClearSettings !== 'undefined') {
        LexiClearSettings.applyTheme(value);
        LexiClearSettings.setTheme(value);
      } else {
        chrome.storage.local.set({ theme: value });
        if (typeof document !== 'undefined' && document.body) {
          if (value === 'light') document.body.classList.add('theme-light');
          else if (value === 'dark') document.body.classList.remove('theme-light');
          else if (value === 'system') {
            const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
            document.body.classList.toggle('theme-light', prefersLight);
          }
        }
      }
    });
  });

  if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener('click', () => {
      loadHistoryFromStorage().then((items) => {
        const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lexiclear-history-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (typeof LexiClearSettings !== 'undefined' && LexiClearSettings.showToast) LexiClearSettings.showToast('History exported');
      });
    });
  }

  if (clearAllHistoryBtn) {
    clearAllHistoryBtn.addEventListener('click', () => {
      if (!confirm('Delete all activity history? This cannot be undone.')) return;
      const clearFn = typeof LexiClearSettings !== 'undefined' && LexiClearSettings.clearAllHistory
        ? LexiClearSettings.clearAllHistory()
        : new Promise((res) => chrome.storage.local.set({ history: [] }, () => res()));
      clearFn.then(() => {
        refreshHistoryUI();
        if (typeof LexiClearSettings !== 'undefined' && LexiClearSettings.showToast) LexiClearSettings.showToast('History cleared');
      });
    });
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

// Tab Navigation
initTabNavigation();

// Settings (after DOM ready)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSettingsUI);
} else {
  initSettingsUI();
}

// Fake Detection
useCurrentUrlBtn.addEventListener('click', useCurrentPageUrl);
checkFakeBtn.addEventListener('click', handleCheckFake);

// App Comparison
compareUseCurrentBtn.addEventListener('click', useCurrentPageForCompare);
compareAppsBtn.addEventListener('click', handleCompareApps);

// Legal Risk Analyzer
analyzeBtn.addEventListener('click', handleAnalyze);

// Enter key support for inputs
fakeUrlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleCheckFake();
});

comparePrimaryUrl.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleCompareApps();
});
