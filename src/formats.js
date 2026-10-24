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

  return {
    qualities: [...qualities.values()].sort((a, b) => b.tier - a.tier),
    hasVideo: video.length > 0,
    hasVideoOnly: video.some((f) => f.acodec === 'none'),
    hasAudio: formats.some((f) => f.acodec !== 'none'),
  };
}

module.exports = { summarizeFormats };
