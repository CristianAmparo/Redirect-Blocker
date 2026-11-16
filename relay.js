// Runs in the extension's isolated world. Forwards reports from guard.js
// (which runs in the page world and can't use chrome.* APIs) to the background.
if (!window.__redirectGuardRelay) {
  window.__redirectGuardRelay = true;
  document.addEventListener('__rg_blocked', (e) => {
    try {
      const { kind, url } = JSON.parse(e.detail);
      chrome.runtime.sendMessage({ type: 'blocked', kind, url }).catch(() => {});
    } catch {}
  });
}
