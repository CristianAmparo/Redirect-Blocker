import { DEFAULTS, siteOfUrl } from './util.js';

// Navigations the user started themselves (address bar, bookmark, reload...).
const USER_TRANSITIONS = new Set([
  'typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated',
  'start_page', 'reload', 'auto_toplevel',
]);

const pendingTabs = new Map(); // new blank tab id -> { sourceTabId, site }
const lastRevert = new Map();  // tab id -> time of last undone redirect

const getSettings = () => chrome.storage.local.get(DEFAULTS);

async function protectedSiteOf(url) {
  const site = siteOfUrl(url);
  if (!site) return '';
  const { sites } = await getSettings();
  return sites.includes(site) ? site : '';
}

// ---------- session state (log, counters, last good URL per tab) ----------

let chain = Promise.resolve();
function updateSession(key, fallback, fn) {
  const run = chain.then(async () => {
    const current = (await chrome.storage.session.get(key))[key] ?? fallback;
    const next = fn(current);
    await chrome.storage.session.set({ [key]: next });
    return next;
  });
  chain = run.catch((err) => console.error(err));
  return run;
}

async function recordBlock(tabId, kind, url) {
  await updateSession('log', [], (log) =>
    [{ t: Date.now(), tabId, kind, url: String(url ?? '') }, ...log].slice(0, 100));
  const counts = await updateSession('counts', {}, (c) => ({ ...c, [tabId]: (c[tabId] ?? 0) + 1 }));
  setBadge(tabId, counts[tabId]);
}

function setBadge(tabId, n) {
  if (tabId < 0) return;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
}

// ---------- setup ----------

// Run sync jobs one at a time; overlapping register calls fail with "Duplicate script ID".
let syncChain = Promise.resolve();
function serial(fn) {
  const run = syncChain.then(fn);
  syncChain = run.catch((err) => console.error(err));
  return run;
}

const syncContentScripts = () => serial(async () => {
  const { sites } = await getSettings();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  }
  if (!sites.length) return;
  const matches = sites.map((s) => `*://*.${s}/*`); // matches the site and its subdomains
  const common = { matches, allFrames: true, matchOriginAsFallback: true, runAt: 'document_start', persistAcrossSessions: true };
  await chrome.scripting.registerContentScripts([
    { id: 'guard', js: ['guard.js'], world: 'MAIN', ...common },
    { id: 'relay', js: ['relay.js'], ...common },
  ]);
});

const syncDynamicRules = () => serial(async () => {
  const { blockedDomains } = await getSettings();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: blockedDomains.map((domain, i) => ({
      id: i + 1,
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: [domain],
        resourceTypes: ['main_frame', 'sub_frame', 'script', 'xmlhttprequest', 'image', 'ping', 'other'],
      },
    })),
  });
});

async function init() {
  await chrome.storage.local.set(await getSettings()); // write defaults on first run
  await syncContentScripts();
  await syncDynamicRules();
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sites) syncContentScripts();
  if (changes.blockedDomains) syncDynamicRules();
});

// Reports from the page scripts (blocked popups, links, overlays).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'blocked' && sender.tab) recordBlock(sender.tab.id, msg.kind, msg.url);
});

// ---------- tab guard: close ad tabs opened by a protected site ----------

async function closeAdTab(tabId, sourceTabId, url) {
  pendingTabs.delete(tabId);
  await chrome.tabs.remove(tabId).catch(() => {});
  const src = await chrome.tabs.get(sourceTabId).catch(() => null);
  if (src) {
    chrome.tabs.update(sourceTabId, { active: true }).catch(() => {});
    chrome.windows.update(src.windowId, { focused: true }).catch(() => {});
  }
  recordBlock(sourceTabId, 'new-tab', url);
}

const isBlank = (url) => !url || url.startsWith('about:');

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (d) => {
  const src = await chrome.tabs.get(d.sourceTabId).catch(() => null);
  const site = src && (await protectedSiteOf(src.url));
  if (!site) return;
  if (isBlank(d.url)) {
    // Opened empty first, real URL comes later: check it on commit.
    pendingTabs.set(d.tabId, { sourceTabId: d.sourceTabId, site });
    return;
  }
  if (siteOfUrl(d.url) !== site) closeAdTab(d.tabId, d.sourceTabId, d.url);
});

// ---------- navigation guard + frame injection ----------

async function injectIntoFrame(tabId, frameId) {
  const target = { tabId, frameIds: [frameId] };
  await chrome.scripting.executeScript({ target, files: ['relay.js'], injectImmediately: true }).catch(() => {});
  await chrome.scripting.executeScript({ target, files: ['guard.js'], world: 'MAIN', injectImmediately: true }).catch(() => {});
}

chrome.webNavigation.onCommitted.addListener(async (d) => {
  // Sub-frames (e.g. the video player iframe on another domain): inject the guard.
  if (d.frameId !== 0) {
    const tab = await chrome.tabs.get(d.tabId).catch(() => null);
    if (tab && (await protectedSiteOf(tab.url))) injectIntoFrame(d.tabId, d.frameId);
    return;
  }

  // A blank tab opened by a protected site has now loaded its real URL.
  const pending = pendingTabs.get(d.tabId);
  if (pending) {
    if (isBlank(d.url)) return;
    pendingTabs.delete(d.tabId);
    if (siteOfUrl(d.url) !== pending.site) return closeAdTab(d.tabId, pending.sourceTabId, d.url);
  }

  if (!siteOfUrl(d.url)) return; // edge://, about:, etc.

  // Main frame left a protected site without the user asking -> undo it.
  const prev = (await chrome.storage.session.get('lastGood')).lastGood?.[d.tabId];
  const prevSite = prev && (await protectedSiteOf(prev));
  const byUser = USER_TRANSITIONS.has(d.transitionType)
    || d.transitionQualifiers.includes('forward_back')
    || d.transitionQualifiers.includes('from_address_bar');
  const recentlyReverted = Date.now() - (lastRevert.get(d.tabId) ?? 0) < 3000; // avoid loops

  if (prevSite && !byUser && siteOfUrl(d.url) !== prevSite && !recentlyReverted) {
    lastRevert.set(d.tabId, Date.now());
    chrome.tabs.update(d.tabId, { url: prev }).catch(() => {});
    recordBlock(d.tabId, 'redirect', d.url);
    return;
  }

  await updateSession('lastGood', {}, (m) => ({ ...m, [d.tabId]: d.url }));
  const counts = (await chrome.storage.session.get('counts')).counts ?? {};
  setBadge(d.tabId, counts[d.tabId]);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingTabs.delete(tabId);
  lastRevert.delete(tabId);
  updateSession('lastGood', {}, ({ [tabId]: _, ...rest }) => rest);
  updateSession('counts', {}, ({ [tabId]: _, ...rest }) => rest);
});
