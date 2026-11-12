// Run with: node test/errors.test.js
const assert = require('assert');
const { friendlyError, errorFromCode, redact } = require('../src/errors/map');

const cases = [
  ['ERROR: [generic] Unsupported URL: https://x.test/a', {}, 'UNSUPPORTED', true],
  ['ERROR: [generic] Unsupported URL: https://x.test/a', { sniffEnabled: false }, 'UNSUPPORTED', true],
  ['ERROR: [youtube] abc: Sign in to confirm you’re not a bot', {}, 'BOT_CHECK'],
  ['ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access', {}, 'PRIVATE'],
  ['ERROR: Video unavailable. This video is not available in your country', {}, 'GEO'],
  ['ERROR: [youtube] abc: Video unavailable', {}, 'REMOVED'],
  ['ERROR: unable to download video data: HTTP Error 403: Forbidden', { resolver: 'sniff' }, 'EXPIRED'],
  ['ERROR: unable to download video data: HTTP Error 403: Forbidden', { resolver: 'ytdlp' }, 'FORBIDDEN'],
  ['HTTP Error 429: Too Many Requests', {}, 'RATE_LIMIT'],
  ['<urlopen error [Errno 8] nodename nor servname provided>', {}, 'NETWORK'],
  ['OSError: [Errno 28] No space left on device', {}, 'DISK_FULL'],
  ['ERROR: This video is DRM protected', {}, 'DRM'],
  ['ERROR: [vimeo] 1: This video is protected by a password, use the --video-password option', {}, 'PASSWORD'],
  ['ERROR: [vimeo] 1: Wrong password', {}, 'WRONG_PASSWORD'],
  ['Conversion failed!', { source: 'ffmpeg' }, 'FFMPEG'],
  ['something nobody has seen', {}, 'UNKNOWN'],
];

for (const [raw, ctx, code] of cases) {
  const err = friendlyError(raw, ctx);
  assert.strictEqual(err.code, code, `${raw} -> ${err.code}, wanted ${code}`);
  assert.ok(err.message && !/yt-dlp|ERROR:/.test(err.message.replace('after yt-dlp updates', '')), `message is plain: ${err.message}`);
}

// Sniff off: the unsupported message changes and offers to turn capture on.
assert.strictEqual(friendlyError('Unsupported URL: x', { sniffEnabled: false }).action.id, 'enable-sniff');
assert.strictEqual(friendlyError('Unsupported URL: x', { sniffEnabled: true }).action, undefined);

// Passwords and tokens never reach Details.
const cmd = 'yt-dlp --video-password hunter2 https://sahls.frame.io/encode-hls/a/token/eyJhbGciOi.eyJzdWIi.sig/h264_720/1.m4s';
const clean = redact(cmd);
assert.ok(!clean.includes('hunter2') && !clean.includes('eyJhbGci'), clean);
assert.ok(!friendlyError(`${cmd}\nWrong password`, {}).details.includes('hunter2'));

assert.strictEqual(errorFromCode('NO_STREAM_FOUND').action.id, 'show-page');
console.log(`errors: ${cases.length} cases ok`);
