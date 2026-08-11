/**
 * LexiClear - Background service worker
 * Saves activity history so it persists even when the popup closes immediately.
 */

const HISTORY_KEY = 'history';
const MAX_HISTORY = 100;

function saveToHistory(item) {
  chrome.storage.local.get([HISTORY_KEY], (data) => {
    const list = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
    const next = [item].concat(list).slice(0, MAX_HISTORY);
    chrome.storage.local.set({ [HISTORY_KEY]: next });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'SAVE_HISTORY' && message.payload) {
    const p = message.payload;
    const item = {
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
      type: p.type || 'fake',
      input: typeof p.input === 'string' ? p.input : (p.input ? String(p.input) : ''),
      result_summary: p.result_summary || {},
      timestamp: new Date().toISOString(),
    };
    saveToHistory(item);
    sendResponse({ ok: true });
  }
  return true;
});
