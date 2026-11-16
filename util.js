// Shared helpers for the background worker and the popup.

export const DEFAULTS = {
  sites: ['anikototv.bz'], // sites where protection is on
  blockedDomains: [],      // extra ad domains the user blocked from the popup
};

// Second-level labels used in country domains like example.co.uk or example.com.ph
const MULTI_PART = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);

// "player.cdn.example.com" -> "example.com"
export function getSite(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return host; // IP address
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const n = MULTI_PART.has(parts.at(-2)) && parts.at(-1).length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

// Site of an http(s) URL, or '' for anything else.
export function siteOfUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? getSite(u.hostname) : '';
  } catch {
    return '';
  }
}
