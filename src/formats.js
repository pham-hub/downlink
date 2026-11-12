const MIN_HEIGHT = 144;
const TIERS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 2880, 4320];

// The short side is what yt-dlp's "res" sort uses, so vertical 1080x1920 and landscape
// 1920x1080 rank the same.
function shortSide(format) {
  return format.width ? Math.min(format.width, format.height) : format.height;
}

// The name people know it by: 1080x1920 (Shorts) and 1920x804 (widescreen films) are both
// "1080p", 872x480 and 854x470 are both "480p".
function tierOf(format) {
  const p = format.width ? Math.max(shortSide(format), (Math.max(format.width, format.height) * 9) / 16) : format.height;
  return TIERS.reduce((best, t) => (Math.abs(Math.log(p / t)) < Math.abs(Math.log(p / best)) ? t : best));
}

function tierLabel(tier) {
  if (tier >= 4320) return `${tier}p · 8K`;
  if (tier >= 2160) return `${tier}p · 4K`;
  if (tier >= 1440) return `${tier}p · QHD`;
  return `${tier}p`;
}

function isH264(format) {
  return /^(avc|h264)/i.test(format.vcodec || '');
}

// Codec strings as sites report them -> the five names the picker uses.
function normalizeCodec(vcodec) {
  const c = String(vcodec || '').toLowerCase();
  if (/^(avc|h264)/.test(c)) return 'h264';
  if (/^(hvc|hev|h265|hevc)/.test(c)) return 'hevc';
  if (/^(vp09|vp9)/.test(c)) return 'vp9';
  if (/^av01|^av1/.test(c)) return 'av1';
  return 'other';
}

const CODEC_NAMES = { h264: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', other: '' };

function isHdr(format) {
  return /hdr|pq|hlg|dolby/i.test(format.dynamic_range || '') || /hdr/i.test(format.format_note || '');
}

function formatMegabytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// 23.976 stays 23.976, 30.0 becomes 30.
function formatFps(fps) {
  return String(Math.round(fps * 1000) / 1000);
}

// One FormatOption per video format (spec section 6). estBytes is the size the site states,
// else an estimate from the bitrate.
function toFormatOption(format, durationSec) {
  const height = shortSide(format) || format.height || 0;
  const vcodec = normalizeCodec(format.vcodec);
  const hdr = isHdr(format);
  const tbrBytes = format.tbr && durationSec ? (format.tbr * 1000 * durationSec) / 8 : undefined;
  const estBytes = format.filesize || format.filesize_approx || tbrBytes || undefined;
  const option = {
    id: String(format.format_id),
    height: format.height || height,
    width: format.width || undefined,
    fps: format.fps || undefined,
    vcodec,
    hdr,
    hasAudio: format.acodec && format.acodec !== 'none',
    estBytes: estBytes ? Math.round(estBytes) : undefined,
  };
  option.label = [
    height ? `${tierOf({ width: format.width, height: format.height || height })}p` : null,
    [CODEC_NAMES[vcodec], hdr ? 'HDR' : null].filter(Boolean).join(' ') || null,
    format.fps ? formatFps(format.fps) : null,
    estBytes ? `~${formatMegabytes(estBytes)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return option;
}

// AV1, VP9 and HDR streams are the ones some editors and media servers can't open.
function needsCompatibilityBadge(option) {
  return option.vcodec === 'av1' || option.vcodec === 'vp9' || option.hdr;
}

// Turns raw yt-dlp --dump-json output into the few facts the UI needs instead
// of dumping the full (often huge) raw format table.
function summarizeFormats(info) {
  const formats = Array.isArray(info.formats) && info.formats.length ? info.formats : [info];
  // Some sites (Facebook, direct .mp4 links) don't say a format's codecs or size; those still
  // count as video. Only sizes yt-dlp knows go in the quality list.
  const video = formats.filter((f) => f.vcodec !== 'none' && !(f.height < MIN_HEIGHT));
  const sized = video.filter((f) => f.height >= MIN_HEIGHT);

  // One entry per tier. "res" is the largest short side in it: the limit handed to yt-dlp.
  const qualities = new Map();
  sized.forEach((f) => {
    const tier = tierOf(f);
    const q = qualities.get(tier) || { tier, res: 0, label: tierLabel(tier), h264: false };
    q.res = Math.max(q.res, shortSide(f));
    // Max compatibility only offers the tiers that actually come in H.264.
    if (isH264(f)) q.h264 = true;
    qualities.set(tier, q);
  });

  const options = sized
    .map((f) => toFormatOption(f, info.duration))
    .sort((a, b) => b.height - a.height || (b.estBytes || 0) - (a.estBytes || 0));
  const top = options.length ? options[0].height : 0;
  const topOptions = options.filter((o) => o.height === top);

  return {
    qualities: [...qualities.values()].sort((a, b) => b.tier - a.tier),
    // Every individual format, for the Advanced list.
    options,
    // "Best quality (any codec)" can land on a stream some editors can't open.
    bestNeedsBadge: topOptions.some(needsCompatibilityBadge),
    hasVideo: video.length > 0,
    hasVideoOnly: video.some((f) => f.acodec === 'none'),
    hasAudio: formats.some((f) => f.acodec !== 'none'),
  };
}

module.exports = { summarizeFormats, normalizeCodec, toFormatOption, needsCompatibilityBadge };
