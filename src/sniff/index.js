// Stream capture fallback (spec section 1).
//
// When yt-dlp can't read a page, load it in a hidden window, let the site's own player ask for
// its stream, and note which HLS, DASH or MP4 URL it used. Nothing is shown and nothing
// plays out loud; the window and its session are thrown away as soon as it's done.
// No sign-in happens here, and DRM-protected pages are refused, never worked around.

const { BrowserWindow, session } = require('electron');
const path = require('path');
const adapters = require('./adapters');
const { classifyPlaylist, parseMaster, playlistDuration } = require('./hls');

// Matches the Chrome that ships with the bundled Electron.
const USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const TOTAL_TIMEOUT = 25 * 1000;
const VISIBLE_TIMEOUT = 5 * 60 * 1000; // the person may be solving a captcha or typing a password
const PLAY_BUTTON_AFTER = 4 * 1000;
const SETTLE = 1200; // wait a moment after a good candidate for a better one
const MAX_SEGMENTS_KEPT = 30;

const MEDIA_EXT = /\.(m3u8|mpd|mp4|m4v|mov|webm|m4s)(?:$|[?#])/i;
const HLS_TYPES = /application\/(vnd\.apple\.mpegurl|x-mpegurl)/i;
const DASH_TYPE = /application\/dash\+xml/i;
const DRM_URL = /widevine|playready|fairplay|\/license/i;

const PLAY_SCRIPT = `(() => {
  const v = document.querySelector('video');
  if (v) { v.muted = true; v.play().catch(() => {}); }
})()`;

// Only if nothing showed up after a few seconds, and only an obvious play button, once.
const CLICK_PLAY_SCRIPT = `(() => {
  const el = document.querySelector('[aria-label*="play" i], button[class*="play" i]');
  if (el) el.click();
})()`;

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function kindFromUrl(url, contentType) {
  const pathname = (() => {
    try { return new URL(url).pathname; } catch { return url; }
  })();
  if (/\.m4s$/i.test(pathname)) return 'segment';
  if (/\.m3u8$/i.test(pathname) || HLS_TYPES.test(contentType)) return 'hls-media'; // refined below
  if (/\.mpd$/i.test(pathname) || DASH_TYPE.test(contentType)) return 'dash';
  if (/\.(mp4|m4v|mov|webm)$/i.test(pathname) || /^video\//i.test(contentType)) return 'progressive';
  return null;
}

// Starts a capture. Returns a promise for a SniffResult; promise.cancel() stops it.
// visible: show the page so the person can get past a captcha or password form; the capture
// keeps watching and finishes as soon as a stream plays.
function sniff(pageUrl, { jobId, onStatus, visible = false } = {}) {
  let cancelFn = () => {};
  const promise = new Promise((resolve, reject) => {
    const ses = session.fromPartition(`downlink-sniff-${jobId}`); // not persistent: no "persist:" prefix
    ses.setUserAgent(USER_AGENT);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.on('will-download', (e) => e.preventDefault());

    const win = new BrowserWindow({
      show: visible,
      width: visible ? 1100 : 1280,
      height: 720,
      title: 'Downlink: find the video',
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    win.webContents.setAudioMuted(!visible);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const requestHeaders = new Map(); // url -> { referer, origin, userAgent }
    const candidates = [];
    const seen = new Set();
    let finished = false;
    let drm = false;
    let firstGoodAt = 0;
    let firstAnyAt = 0;
    let timers = [];

    function cleanup() {
      timers.forEach(clearTimeout);
      timers = [];
      clearInterval(poll);
      try {
        if (!win.isDestroyed()) win.destroy();
      } catch {
        // already gone
      }
      ses.clearStorageData().catch(() => {});
      ses.clearCache().catch(() => {});
    }

    function done(err, result) {
      if (finished) return;
      finished = true;
      // Cookies are read before the session is cleared; they're only used for this job.
      cleanup();
      if (err) reject(err);
      else resolve(result);
    }
    cancelFn = () => done(fail('CANCELLED', 'Cancelled'));

    const headersFor = (candidate) => ({ ...candidate.headers });

    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const h = details.requestHeaders || {};
      requestHeaders.set(details.url, {
        referer: h.Referer || h.referer,
        origin: h.Origin || h.origin,
        userAgent: h['User-Agent'] || USER_AGENT,
      });
      if (DRM_URL.test(details.url)) drm = true;
      cb({ requestHeaders: details.requestHeaders });
    });

    ses.webRequest.onHeadersReceived((details, cb) => {
      cb({});
      if (finished) return;
      const type = (details.responseHeaders && (details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'])) || [];
      const contentType = Array.isArray(type) ? type[0] : String(type);
      const lengthHeader = details.responseHeaders && (details.responseHeaders['content-length'] || details.responseHeaders['Content-Length']);
      const looksLikeMedia = MEDIA_EXT.test(details.url) || HLS_TYPES.test(contentType) || DASH_TYPE.test(contentType) || /^video\//i.test(contentType);
      if (!looksLikeMedia || seen.has(details.url)) return;
      const kind = kindFromUrl(details.url, contentType);
      if (!kind) return;
      seen.add(details.url);
      if (kind === 'segment' && candidates.filter((c) => c.kind === 'segment').length >= MAX_SEGMENTS_KEPT) return;
      const candidate = {
        url: details.url,
        kind,
        headers: requestHeaders.get(details.url) || { userAgent: USER_AGENT },
        contentLength: lengthHeader ? Number(Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader) || undefined : undefined,
        seenAt: Date.now(),
      };
      candidates.push(candidate);
      if (!firstAnyAt) firstAnyAt = Date.now();
      if (kind === 'hls-media') classifyHls(candidate);
    });

    async function fetchWith(url, headers = {}) {
      const h = {};
      if (headers.referer) h.Referer = headers.referer;
      if (headers.origin) h.Origin = headers.origin;
      return ses.fetch(url, { headers: { 'User-Agent': headers.userAgent || USER_AGENT, ...h } });
    }

    // HLS is told apart by what's inside the playlist.
    async function classifyHls(candidate) {
      try {
        const res = await fetchWith(candidate.url, candidate.headers);
        if (res.status !== 200) return;
        const body = await res.text();
        const kind = classifyPlaylist(body);
        if (!kind) return;
        candidate.kind = kind;
        if (kind === 'hls-master') candidate.variants = parseMaster(body, candidate.url);
        else candidate.durationSec = playlistDuration(body);
        if (!firstGoodAt && kind === 'hls-master') firstGoodAt = Date.now();
      } catch {
        // the playlist wasn't readable; the candidate stays a plain media playlist
      }
    }

    win.webContents.on('console-message', (event, level, message) => {
      const text = typeof message === 'string' ? message : event && event.message;
      if (text === '__DOWNLINK_DRM__') drm = true;
    });

    const pageTitle = async () => {
      if (win.isDestroyed()) return undefined;
      try {
        return await win.webContents.executeJavaScript(
          `(document.querySelector('meta[property="og:title"]')||{}).content || document.title || ''`
        );
      } catch {
        return undefined;
      }
    };
    const posterUrl = async () => {
      if (win.isDestroyed()) return undefined;
      try {
        return (
          (await win.webContents.executeJavaScript(
            `(document.querySelector('video')||{}).poster || (document.querySelector('meta[property="og:image"]')||{}).content || ''`
          )) || undefined
        );
      } catch {
        return undefined;
      }
    };

    const ctx = { pageUrl, fetch: fetchWith, pageTitle, posterUrl, headersFor };

    async function withCookie(result) {
      try {
        const cookies = await ses.cookies.get({ url: result.video.url });
        if (cookies.length) result.headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      } catch {
        // no cookies for that host
      }
      return result;
    }

    // Picks the best stream by the spec's priority order.
    async function pickGeneric() {
      const masters = candidates.filter((c) => c.kind === 'hls-master');
      const dash = candidates.filter((c) => c.kind === 'dash');
      const progressive = candidates.filter((c) => c.kind === 'progressive');
      const media = candidates.filter((c) => c.kind === 'hls-media');
      let chosen;
      if (masters.length) chosen = masters.sort((a, b) => (b.variants || []).length - (a.variants || []).length)[0];
      else if (dash.length) chosen = dash[0];
      else if (progressive.length) chosen = progressive.sort((a, b) => (b.contentLength || 0) - (a.contentLength || 0))[0];
      else if (media.length) chosen = media[0];
      if (!chosen) return null;
      const variants = (chosen.variants || []).map((v, i) => ({
        id: String(i),
        url: v.url,
        height: v.height || 0,
        width: v.width,
        fps: v.fps,
        vcodec: /avc1|h264/i.test(v.codecs) ? 'h264' : /hvc1|hev1/i.test(v.codecs) ? 'hevc' : /av01/i.test(v.codecs) ? 'av1' : /vp0?9/i.test(v.codecs) ? 'vp9' : 'other',
        hdr: false,
        hasAudio: true,
        estBytes: undefined,
        label: [v.height ? `${v.height}p` : null, v.fps || null].filter(Boolean).join(' · ') || 'Stream',
      }));
      return {
        pageUrl,
        pageTitle: await pageTitle(),
        video: { url: chosen.url, kind: chosen.kind },
        headers: headersFor(chosen),
        variants: variants.length ? variants : undefined,
        durationSec: chosen.durationSec,
        posterUrl: await posterUrl(),
      };
    }

    let resolving = false;
    async function attempt() {
      if (finished || resolving) return;
      if (drm) return done(fail('DRM'));
      resolving = true;
      try {
        // A site adapter wins over everything else.
        for (const adapter of adapters) {
          if (!candidates.some((c) => adapter.match(c))) continue;
          const result = await adapter.resolve(candidates, ctx);
          if (result) return done(null, await withCookie(result));
        }
        const goodSince = firstGoodAt || (candidates.some((c) => c.kind === 'dash' || c.kind === 'progressive') ? firstAnyAt : 0);
        const anySince = firstAnyAt;
        const now = Date.now();
        const ready = (goodSince && now - goodSince >= SETTLE) || (anySince && now - anySince >= 6000);
        if (ready) {
          const generic = await pickGeneric();
          if (generic) return done(null, await withCookie(generic));
        }
      } catch (err) {
        return done(err);
      } finally {
        resolving = false;
      }
    }

    const poll = setInterval(attempt, 500);

    timers.push(setTimeout(() => done(drm ? fail('DRM') : fail('NO_STREAM_FOUND')), visible ? VISIBLE_TIMEOUT : TOTAL_TIMEOUT));
    if (visible) win.on('closed', () => done(fail('NO_STREAM_FOUND')));

    win.webContents.on('did-finish-load', () => {
      if (finished) return;
      win.webContents.executeJavaScript(PLAY_SCRIPT).catch(() => {});
      timers.push(setTimeout(() => {
        if (!finished && !candidates.length) win.webContents.executeJavaScript(CLICK_PLAY_SCRIPT).catch(() => {});
      }, PLAY_BUTTON_AFTER));
      // Players that mount late get a second nudge.
      timers.push(setTimeout(() => {
        if (!finished) win.webContents.executeJavaScript(PLAY_SCRIPT).catch(() => {});
      }, 2500));
    });
    win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) done(fail('NETWORK', `Page failed to load: ${desc}`));
    });

    if (onStatus) onStatus('capturing');
    win.loadURL(pageUrl, { userAgent: USER_AGENT }).catch(() => {});
  });
  promise.cancel = () => cancelFn();
  return promise;
}

module.exports = { sniff, USER_AGENT };
