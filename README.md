# Redirect Guard

Personal Edge extension that stops popup tabs, hidden ad links and forced redirects on streaming sites.

## Install (Edge)

1. Open `edge://extensions`
2. Turn on **Developer mode** (left sidebar)
3. Click **Load unpacked** and pick this folder (`AdsblockerExtention`)
4. Pin the extension so its badge (blocked count) is visible

After editing any file, click **Reload** on the extension card, then reload the site.

## Use

- Protection is **opt-in per site**. `anikototv.bz` is on by default.
- To protect another site: open it, click the extension icon, flip the switch, reload.
- The popup lists what was blocked on the current tab. Click **Block** next to an ad domain to block it everywhere.
- If a site breaks, switch protection off for it.

## How it works

| File | Job |
|---|---|
| `background.js` | Closes ad tabs opened by a protected site, undoes redirects of the main tab, injects the guard into player iframes, keeps the log and badge |
| `guard.js` | Runs in the page: blocks `window.open` popups, ad links and invisible click-overlays |
| `relay.js` | Passes reports from `guard.js` to the background |
| `rules.json` | Network blocklist of known popup ad networks |
| `popup.*` | Per-site switch, blocked log, your own domain blocklist |
