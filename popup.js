import { DEFAULTS, siteOfUrl } from './util.js';

const $ = (id) => document.getElementById(id);
const KIND_LABELS = {
  'popup': 'Popup',
  'new-tab': 'Tab closed',
  'redirect': 'Redirect undone',
  'link': 'Ad link',
  'hidden-link': 'Hidden link',
  'overlay': 'Overlay',
};

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const site = siteOfUrl(tab?.url ?? '');

function hostOf(url) {
  try { return new URL(url).hostname || url; } catch { return url || '(blank)'; }
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function updateList(key, fn) {
  const settings = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({ [key]: fn(settings[key]) });
}

async function render() {
  const { sites, blockedDomains } = await chrome.storage.local.get(DEFAULTS);
  const { log = [], counts = {} } = await chrome.storage.session.get(['log', 'counts']);

  // Current site + toggle
  $('site').textContent = site || 'Not a website';
  $('toggle').disabled = !site;
  $('toggle').checked = !!site && sites.includes(site);
  $('count').textContent = counts[tab?.id] ?? 0;

  // Log for this tab
  const entries = log.filter((e) => e.tabId === tab?.id).slice(0, 25);
  const logList = $('log');
  logList.replaceChildren();
  if (!entries.length) logList.append(el('li', { className: 'empty', textContent: 'Nothing blocked on this tab yet.' }));
  for (const e of entries) {
    const domain = siteOfUrl(e.url);
    const li = el('li', {},
      el('span', { className: 'kind', textContent: KIND_LABELS[e.kind] ?? e.kind }),
      el('span', { className: 'host', textContent: hostOf(e.url), title: e.url }));
    if (domain && !blockedDomains.includes(domain) && !sites.includes(domain)) {
      const btn = el('button', { textContent: 'Block', title: `Block all requests to ${domain}` });
      btn.onclick = () => updateList('blockedDomains', (list) => [...new Set([...list, domain])]);
      li.append(btn);
    }
    logList.append(li);
  }

  // Blocked domains
  const domList = $('domains');
  domList.replaceChildren();
  if (!blockedDomains.length) domList.append(el('li', { className: 'empty', textContent: 'None yet. Use "Block" above.' }));
  for (const d of blockedDomains) {
    const btn = el('button', { textContent: 'Remove' });
    btn.onclick = () => updateList('blockedDomains', (list) => list.filter((x) => x !== d));
    domList.append(el('li', {}, el('span', { className: 'host', textContent: d }), btn));
  }
}

$('toggle').addEventListener('change', async (e) => {
  const on = e.target.checked;
  await updateList('sites', (list) => (on ? [...new Set([...list, site])] : list.filter((s) => s !== site)));
  $('note').classList.add('show');
});

$('reload').addEventListener('click', () => {
  chrome.tabs.reload(tab.id);
  window.close();
});

chrome.storage.onChanged.addListener(render);
render();
