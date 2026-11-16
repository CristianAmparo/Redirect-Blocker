// Runs inside the page's own JavaScript (MAIN world) at document_start,
// in every frame of a protected site, including the cross-domain video player.
(() => {
  if (window.__redirectGuard) return;
  Object.defineProperty(window, '__redirectGuard', { value: true });

  const MULTI_PART = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
  function siteOf(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (/^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return host;
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const n = MULTI_PART.has(parts.at(-2)) && parts.at(-1).length === 2 ? 3 : 2;
    return parts.slice(-n).join('.');
  }

  // The site shown in the address bar (outermost frame).
  let topSite = /^https?:$/.test(location.protocol) ? siteOf(location.hostname) : '';
  try {
    const ancestors = location.ancestorOrigins;
    if (ancestors && ancestors.length) topSite = siteOf(new URL(ancestors[ancestors.length - 1]).hostname);
  } catch {}

  const isTop = window === window.top;

  // May this URL open in a new window or take over the whole tab?
  function isAllowed(url) {
    if (url == null || String(url).trim() === '') return false; // window.open() -> blank popunder
    let u;
    try { u = new URL(String(url), location.href); } catch { return false; }
    if (u.protocol === 'http:' || u.protocol === 'https:') return siteOf(u.hostname) === topSite;
    return !['about:', 'data:', 'blob:'].includes(u.protocol);
  }

  function anchorAllowed(a) {
    const target = (a.target || '').toLowerCase();
    // Links that only navigate inside a sub-frame (player) are fine.
    if (!isTop && (target === '' || target === '_self')) return true;
    return isAllowed(a.href);
  }

  function report(kind, url) {
    try {
      document.dispatchEvent(new CustomEvent('__rg_blocked', {
        detail: JSON.stringify({ kind, url: String(url ?? '').slice(0, 500) }),
      }));
    } catch {}
  }

  // ---- 1. window.open: block popups/popunders to other sites ----
  const noop = () => {};
  const fakeWindow = () => ({
    closed: false, opener: null,
    close() { this.closed = true; }, focus: noop, blur: noop, postMessage: noop,
    document: { write: noop, writeln: noop, open: noop, close: noop },
    location: { href: 'about:blank', assign: noop, replace: noop },
  });

  const patched = new WeakSet();
  function patchWindow(w) {
    if (patched.has(w)) return;
    const nativeOpen = w.open;
    const guardedOpen = function open(url, ...rest) {
      if (isAllowed(url)) return nativeOpen.call(w, url, ...rest);
      report('popup', url);
      return fakeWindow();
    };
    try {
      Object.defineProperty(w, 'open', { value: guardedOpen, writable: false, configurable: false });
    } catch {
      w.open = guardedOpen;
    }
    patched.add(w);
  }
  patchWindow(window);

  // Ad scripts grab a clean window.open from a fresh iframe; patch those too.
  const cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    ...cwDesc,
    get() {
      const w = cwDesc.get.call(this);
      if (w) { try { patchWindow(w); } catch {} } // throws for cross-origin frames, that's fine
      return w;
    },
  });

  // ---- 2. hidden links clicked from script ----
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    if (!anchorAllowed(this)) { report('hidden-link', this.href); return; }
    return nativeClick.call(this);
  };

  const nativeDispatch = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
    if (this instanceof HTMLAnchorElement && event?.type === 'click' && !anchorAllowed(this)) {
      report('hidden-link', this.href);
      return false;
    }
    return nativeDispatch.call(this, event);
  };

  // ---- 3. real clicks on ad links and invisible overlays ----
  function isTransparent(color) {
    return color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
  }

  // A fixed/absolute element covering most of the screen that you can't see.
  function findOverlay(el) {
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      const r = n.getBoundingClientRect();
      if (r.width < innerWidth * 0.8 || r.height < innerHeight * 0.8) continue;
      const invisible = parseFloat(cs.opacity) < 0.1
        || (isTransparent(cs.backgroundColor)
          && cs.backgroundImage === 'none'
          && !n.textContent.trim()
          && !n.querySelector('img, video, canvas, svg, iframe'));
      if (invisible) return n;
    }
    return null;
  }

  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const a = t.closest('a[href]');
    if (a && !anchorAllowed(a)) {
      stop(e);
      report('link', a.href);
      return;
    }
    // Only in the main page: the player's own layers look like overlays too.
    if (isTop) {
      const overlay = findOverlay(t);
      if (overlay) {
        overlay.style.setProperty('pointer-events', 'none', 'important');
        stop(e);
        report('overlay', a?.href || location.href);
      }
    }
  }

  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
})();
