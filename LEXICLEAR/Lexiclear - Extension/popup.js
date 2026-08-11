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

function renderCompareResult(data) {
  compareResult.style.display = 'block';
  compareTableBody.innerHTML = '';
  
  const recommended = data.recommended_app;
  const results = data.comparison_results || [];
  
  if (recommended) {
    compareRecommended.style.display = 'block';
    compareRecommended.textContent = `✓ Recommended: ${recommended.app || recommended.url}`;
  } else {
    compareRecommended.style.display = 'none';
  }
  
  results.forEach((app, index) => {
    const row = document.createElement('tr');
    if (app.app === recommended?.app || app.url === recommended?.url) {
      row.classList.add('recommended');
    }
    
    const statusClass = app.status?.includes('Safe') ? 'safe' : 
                        app.status?.includes('Moderate') ? 'moderate' : 'high';
    
    row.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${app.app || 'Unknown'}</strong><br><small style="color: var(--text-tertiary);">${app.url || ''}</small></td>
      <td>${app.risk_score?.toFixed(1) || '—'}</td>
      <td><span class="table-status ${statusClass}">${app.status || 'Unknown'}</span></td>
    `;
    
    compareTableBody.appendChild(row);
  });
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
  setStatus(compareStatus, 'Comparing with competitors...', 'loading');
  setButtonLoading(compareAppsBtn, true);

  try {
    const response = await fetch(COMPARE_APPS_ENDPOINT, {
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
// EVENT LISTENERS
// ============================================

// Tab Navigation
initTabNavigation();

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
