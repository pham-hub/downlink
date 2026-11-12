// Plain-English errors (spec section 3).
//
// Raw yt-dlp / ffmpeg output goes in, a FriendlyError comes out:
//   { code, message, action?: { id, label }, details }
// `details` keeps the raw output (with passwords and tokens removed) for the collapsible
// Details panel. The UI never shows it by default.
//
// The list is ordered and the first match wins. An entry can narrow itself with `when(ctx)`.
// ctx: { resolver: 'ytdlp' | 'sniff', source: 'ytdlp' | 'ffmpeg', sniffEnabled: boolean }

const platformFolderLabel = process.platform === 'win32' ? 'Show in Explorer' : 'Show in Finder';

const ACTIONS = {
  retry: { id: 'retry', label: 'Retry' },
  showPage: { id: 'show-page', label: 'Show the page' },
  tryAgain: { id: 'retry-password', label: 'Try again' },
  enableSniff: { id: 'enable-sniff', label: 'Turn on stream capture' },
  showFolder: { id: 'show-folder', label: platformFolderLabel },
  retryOriginal: { id: 'retry-original', label: 'Retry with Original preset' },
};

const ERROR_TABLE = [
  {
    code: 'DRM',
    pattern: /DRM[ -]protected/i,
    message: "This video is DRM-protected and can't be downloaded.",
  },
  {
    code: 'WRONG_PASSWORD',
    pattern: /wrong (video )?password|invalid (video )?password|incorrect (video )?password/i,
    message: "That password didn't work.",
    action: ACTIONS.tryAgain,
  },
  {
    code: 'PASSWORD',
    pattern: /protected by a password|video-password|requires a password|password.+required/i,
    message: 'This video needs a password.',
  },
  {
    code: 'UNSUPPORTED',
    pattern: /Unsupported URL/i,
    message: (ctx) =>
      ctx.sniffEnabled === false
        ? "This site isn't supported."
        : "Downlink can't read this site directly. Trying stream capture…",
    action: (ctx) => (ctx.sniffEnabled === false ? ACTIONS.enableSniff : undefined),
  },
  {
    // Not in the spec table. YouTube's "Sign in to confirm you're not a bot" would otherwise
    // read as a private video.
    code: 'BOT_CHECK',
    pattern: /not a bot/i,
    message: "YouTube wants to confirm you're not a bot. Wait a few minutes and try again.",
    action: ACTIONS.retry,
  },
  {
    code: 'PRIVATE',
    pattern: /Private video|This video is private|login required|sign in to confirm|\bsign in\b|\blog in\b|logged-in|--cookies/i,
    message: "This video is private or needs a sign-in, which Downlink doesn't support.",
  },
  {
    code: 'GEO',
    pattern: /not available in your (country|region)|geo.?restrict|from your location/i,
    message: 'This video is blocked in your region.',
  },
  {
    code: 'REMOVED',
    pattern: /has been removed|Video unavailable|HTTP Error 404|: Not found|\b404 Not Found/i,
    message: 'This video was removed or the link is wrong.',
  },
  {
    code: 'EXPIRED',
    pattern: /403 Forbidden|HTTP Error 403/i,
    when: (ctx) => ctx.resolver === 'sniff',
    message: 'The link expired. Open the share again and retry.',
    action: ACTIONS.retry,
  },
  {
    code: 'FORBIDDEN',
    pattern: /HTTP Error 403/i,
    message: 'The site refused the download. This usually clears after yt-dlp updates.',
    action: ACTIONS.retry,
  },
  {
    code: 'RATE_LIMIT',
    pattern: /HTTP Error 429|Too Many Requests/i,
    message: 'The site is rate-limiting downloads. Wait a few minutes and retry.',
    action: ACTIONS.retry,
  },
  {
    code: 'NETWORK',
    pattern: /timed out|Connection reset|Name or service not known|getaddrinfo|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|nodename nor servname|Failed to resolve|Unable to connect|Network is unreachable|Temporary failure in name resolution/i,
    message: 'Network problem. Check your connection.',
    action: ACTIONS.retry,
  },
  {
    code: 'DISK_FULL',
    pattern: /No space left on device|ENOSPC/i,
    message: 'Your disk is full.',
    action: ACTIONS.showFolder,
  },
  {
    // Not in the spec table; the app already told people this.
    code: 'PERMISSION',
    pattern: /Permission denied|Operation not permitted|EACCES|EPERM|Read-only file system/i,
    message: "Can't save to that folder. Choose a different one.",
    action: ACTIONS.showFolder,
  },
  {
    code: 'INVALID_URL',
    pattern: /is not a valid URL|Incomplete YouTube ID/i,
    message: "That doesn't look like a valid video link.",
  },
  {
    code: 'FORMAT_UNAVAILABLE',
    pattern: /Requested format is not available/i,
    message: "That quality isn't available for this video. Pick another one.",
  },
  {
    code: 'FFMPEG',
    pattern: /[\s\S]*/,
    when: (ctx) => ctx.source === 'ffmpeg',
    message: 'Converting the file failed.',
    action: ACTIONS.retryOriginal,
  },
];

// Errors the app raises itself rather than reading from stderr.
const CODED = {
  NO_STREAM_FOUND: { message: "Couldn't find a video on this page.", action: ACTIONS.showPage },
  DRM: { message: "This video is DRM-protected and can't be downloaded." },
  PLAYLIST: { message: "That's a playlist or channel link. Open a single video and paste its link." },
  LIVE: { message: "This is a live stream. It can be downloaded once it's over." },
  NOT_STARTED: { message: "This video hasn't started yet." },
  RESOLVE_TIMEOUT: {
    message: 'This link took too long to load. Check it and your connection, then try again.',
    action: ACTIONS.retry,
  },
  NO_VIDEO: { message: 'Could not read video information for this URL.', action: ACTIONS.retry },
  DISK_FULL: { message: 'Your disk is full.', action: ACTIONS.showFolder },
  WRONG_PASSWORD: { message: "That password didn't work.", action: ACTIONS.tryAgain },
  INVALID_URL: { message: 'Please enter a valid video URL.' },
  PERMISSION: { message: "Can't save to that folder. Choose a different one.", action: ACTIONS.showFolder },
  UNKNOWN: { message: 'Something went wrong.', action: ACTIONS.retry },
};

// Live and not-yet-started streams are better told apart by what yt-dlp says than by a code.
const LIVE_TABLE = [
  { code: 'NOT_STARTED', pattern: /Premieres in|live event will begin|This live event/i },
  { code: 'LIVE', pattern: /live stream recording is not available|is currently live|stream is live/i },
];

// Takes passwords and tokens out of anything that could be shown, copied or logged.
function redact(text) {
  return String(text == null ? '' : text)
    .replace(/(--video-password(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, '$1[hidden]')
    .replace(/(\/token\/)[^/\s"']+/g, '$1[token]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]')
    .replace(/((?:Cookie|Authorization)\s*:\s*)[^\r\n"']*/gi, '$1[hidden]');
}

function resolveField(value, ctx) {
  return typeof value === 'function' ? value(ctx) : value;
}

function build(code, message, action, raw) {
  const error = { code, message, details: redact(raw).trim() };
  if (action) error.action = action;
  return error;
}

// Maps raw yt-dlp / ffmpeg output to a FriendlyError.
function friendlyError(raw, ctx = {}) {
  const text = String(raw == null ? '' : raw);
  const live = LIVE_TABLE.find((entry) => entry.pattern.test(text));
  if (live) return errorFromCode(live.code, text);
  const entry = ERROR_TABLE.find((e) => (!e.when || e.when(ctx)) && e.pattern.test(text));
  if (!entry) return errorFromCode('UNKNOWN', text);
  return build(entry.code, resolveField(entry.message, ctx), resolveField(entry.action, ctx), text);
}

function errorFromCode(code, raw = '') {
  const known = CODED[code] || CODED.UNKNOWN;
  return build(CODED[code] ? code : 'UNKNOWN', known.message, known.action, raw);
}

module.exports = { friendlyError, errorFromCode, redact, ACTIONS };
