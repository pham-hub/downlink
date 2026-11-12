// Clipboard watch (spec section 7). Looks for a single web link on the clipboard and offers to
// download it. Nothing from the clipboard is logged, stored or sent anywhere: only link-shaped
// text is looked at, and the links already offered are remembered in memory for 30 minutes.

const { clipboard } = require('electron');

const OFFER_MEMORY = 30 * 60 * 1000;
const POLL_INTERVAL = 1500; // Electron has no clipboard change event
const MAX_LENGTH = 2048;

// localhost and private network addresses are never offered.
function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

// The link to offer for some clipboard text, or null.
function offerableUrl(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > MAX_LENGTH || /\s/.test(t) || !/^https?:\/\//i.test(t)) return null;
  try {
    const url = new URL(t);
    if (!url.hostname || isPrivateHost(url.hostname)) return null;
    return t;
  } catch {
    return null;
  }
}

function createWatcher({ getMode, isQueued, onOffer, now = Date.now }) {
  const offered = new Map(); // link -> time it was offered
  let timer = null;

  function check() {
    const mode = getMode();
    if (mode === 'off') return;
    const link = offerableUrl(clipboard.readText());
    if (!link) return;
    const t = now();
    for (const [seen, when] of offered) if (t - when > OFFER_MEMORY) offered.delete(seen);
    if (offered.has(link) || isQueued(link)) return;
    offered.set(link, t);
    onOffer(link);
  }

  return {
    // Call when the window gains focus.
    onFocus() {
      if (getMode() !== 'off') check();
    },
    // Starts or stops polling to match the setting.
    apply() {
      const mode = getMode();
      if (mode === 'background' && !timer) timer = setInterval(check, POLL_INTERVAL);
      if (mode !== 'background' && timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    check,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { offerableUrl, isPrivateHost, createWatcher };
