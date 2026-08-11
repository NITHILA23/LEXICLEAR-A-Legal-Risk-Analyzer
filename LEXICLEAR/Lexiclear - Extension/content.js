/**
 * Legal Risk Analyzer - Content Script
 * Handles DOM extraction only. Runs in page context to access document.body.
 * Supports: EXTRACT_PAGE_TEXT (Legal Risk Analyzer), GET_SAFETY_DATA (Website Safety Checker).
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === 'EXTRACT_PAGE_TEXT') {
    try {
      const text = extractFullPageText();
      sendResponse({ success: true, text });
    } catch (err) {
      sendResponse({
        success: false,
        error: err?.message || 'Failed to extract page text',
      });
    }
    return true;
  }

  if (message?.action === 'GET_SAFETY_DATA') {
    getSafetyData()
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Safety data failed' }));
    return true;
  }

  return false;
});

/**
 * Extracts full visible text from the current page.
 * Uses document.body.innerText for clean, human-readable text (no scripts/styles).
 * @returns {string} Full page text
 */
function extractFullPageText() {
  if (!document?.body) {
    throw new Error('Page body not available');
  }

  const text = document.body.innerText;

  if (text == null || text === undefined) {
    throw new Error('Could not read page text');
  }

  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * Website Safety Checker: extract visible text, footer content, and links to
 * Terms, Privacy, Contact, About. Optionally fetch same-origin legal page content.
 * @returns {Promise<{visibleText: string, footerText: string, links: Array<{href: string, text: string}>, legalPageTexts: Object}>}
 */
async function getSafetyData() {
  if (!document?.body) {
    throw new Error('Page body not available');
  }

  const visibleText = String(document.body.innerText || '').replace(/\s+/g, ' ').trim();
  const html = document.documentElement ? document.documentElement.outerHTML : '';

  // Extract footer: last footer element or element with id/class containing "footer"
  let footerText = '';
  const footerEl = document.querySelector('footer, [role="contentinfo"], .footer, #footer, [class*="footer"]');
  if (footerEl) {
    footerText = String(footerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  }

  // Collect links that look like Terms, Privacy, Contact, About
  const links = [];
  const linkSelectors = document.querySelectorAll('a[href]');
  const baseUrl = window.location.origin + window.location.pathname;
  const origin = window.location.origin;

  const termsPatterns = ['terms', 'tos', 'conditions', 'terms-of-service', 'terms_of_service'];
  const privacyPatterns = ['privacy', 'policy', 'gdpr', 'data-protection'];
  const contactPatterns = ['contact', 'support', 'help', 'reach'];
  const aboutPatterns = ['about', 'about-us', 'company'];

  linkSelectors.forEach((a) => {
    const href = (a.getAttribute('href') || '').trim();
    const text = (a.textContent || '').toLowerCase().replace(/\s+/g, ' ');
    const hrefLower = href.toLowerCase();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    let type = null;
    if (termsPatterns.some((p) => hrefLower.includes(p) || text.includes(p))) type = 'terms';
    else if (privacyPatterns.some((p) => hrefLower.includes(p) || text.includes(p))) type = 'privacy';
    else if (contactPatterns.some((p) => hrefLower.includes(p) || text.includes(p))) type = 'contact';
    else if (aboutPatterns.some((p) => hrefLower.includes(p) || text.includes(p))) type = 'about';

    if (type) {
      let absHref = href;
      if (href.startsWith('/')) absHref = origin + href;
      else if (!href.startsWith('http')) absHref = new URL(href, baseUrl).href;
      if (absHref.startsWith(origin)) {
        links.push({ href: absHref, text: (a.textContent || '').trim().slice(0, 100), type });
      }
    }
  });

  // Fetch same-origin legal pages in parallel (first 5000 chars each) for transparency analysis
  const legalPageTexts = {};
  const toFetch = [];
  const seen = new Set();
  for (const link of links) {
    if (!link.href.startsWith(origin) || seen.has(link.href)) continue;
    seen.add(link.href);
    toFetch.push(link);
  }
  const results = await Promise.all(
    toFetch.map(async (link) => {
      try {
        const res = await fetch(link.href, { method: 'GET', credentials: 'same-origin' });
        if (res.ok) {
          const text = await res.text();
          return { type: link.type || 'other', text: text.replace(/\s+/g, ' ').trim().slice(0, 5000) };
        }
      } catch (_) {
        // ignore fetch errors (CORS, network)
      }
      return null;
    })
  );
  results.forEach((r) => {
    if (r) {
      if (!legalPageTexts[r.type]) legalPageTexts[r.type] = '';
      legalPageTexts[r.type] += r.text;
    }
  });

  return {
    visibleText: visibleText.slice(0, 50000),
    footerText,
    html: html.slice(0, 100000),
    links: links.map((l) => ({ href: l.href, text: l.text, type: l.type })),
    legalPageTexts,
  };
}
