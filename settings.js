/**
 * LexiClear - Settings & Storage Module
 * Theme persistence, activity history, and storage helpers.
 * No detection or scoring logic – UI and persistence only.
 */

(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    theme: 'theme',
    history: 'history',
  };

  const THEME_SYSTEM = 'system';
  const THEME_LIGHT = 'light';
  const THEME_DARK = 'dark';

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  function getSystemPreference() {
    if (typeof window.matchMedia !== 'function') return THEME_DARK;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? THEME_LIGHT : THEME_DARK;
  }

  /**
   * Apply theme to document.body. No reload. Uses CSS variables.
   * @param {string} value - "system" | "light" | "dark"
   */
  function applyTheme(value) {
    const resolved = value === THEME_SYSTEM ? getSystemPreference() : value;
    if (resolved === THEME_LIGHT) {
      document.body.classList.add('theme-light');
    } else {
      document.body.classList.remove('theme-light');
    }
  }

  function getTheme() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([STORAGE_KEYS.theme], function (data) {
        resolve(data[STORAGE_KEYS.theme] || THEME_SYSTEM);
      });
    });
  }

  function setTheme(value) {
    return new Promise(function (resolve) {
      chrome.storage.local.set({ [STORAGE_KEYS.theme]: value }, function () {
        applyTheme(value);
        resolve();
      });
    });
  }

  /**
   * Load stored theme and apply. Call once when popup opens.
   */
  function loadStoredTheme() {
    getTheme().then(function (value) {
      applyTheme(value);
    });
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  function generateId() {
    return 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  /**
   * @param {"fake"|"compare"|"legal"} type
   * @param {string} input - URL or app list description
   * @param {{ score?: number, level?: string, summary?: string, count?: number }} resultSummary
   */
  function saveToHistory(type, input, resultSummary) {
    const item = {
      id: generateId(),
      type: type,
      input: input,
      result_summary: resultSummary || {},
      timestamp: new Date().toISOString(),
    };
    return new Promise(function (resolve, reject) {
      loadHistory()
        .then(function (list) {
          const next = [item].concat(list).slice(0, 100);
          chrome.storage.local.set({ [STORAGE_KEYS.history]: next }, function () {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(item);
          });
        })
        .catch(reject);
    });
  }

  function loadHistory() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([STORAGE_KEYS.history], function (data) {
        const raw = data[STORAGE_KEYS.history];
        resolve(Array.isArray(raw) ? raw : []);
      });
    });
  }

  function deleteHistoryItem(id) {
    return loadHistory().then(function (list) {
      const next = list.filter(function (item) { return item.id !== id; });
      return new Promise(function (resolve, reject) {
        chrome.storage.local.set({ [STORAGE_KEYS.history]: next }, function () {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(next);
        });
      });
    });
  }

  function clearAllHistory() {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.set({ [STORAGE_KEYS.history]: [] }, function () {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve([]);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  function showToast(message) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(function () {
      toast.classList.remove('visible');
    }, 2500);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  global.LexiClearSettings = {
    applyTheme: applyTheme,
    getTheme: getTheme,
    setTheme: setTheme,
    loadStoredTheme: loadStoredTheme,
    saveToHistory: saveToHistory,
    loadHistory: loadHistory,
    deleteHistoryItem: deleteHistoryItem,
    clearAllHistory: clearAllHistory,
    showToast: showToast,
    THEME_SYSTEM: THEME_SYSTEM,
    THEME_LIGHT: THEME_LIGHT,
    THEME_DARK: THEME_DARK,
  };

  // Apply stored theme as soon as script loads (popup is already open, body exists)
  if (typeof document !== 'undefined' && document.body) {
    loadStoredTheme();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', loadStoredTheme);
  }
})(typeof window !== 'undefined' ? window : this);
