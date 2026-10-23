const MIN_HEIGHT = 144;

function qualityLabel(format) {
  // Vertical videos (Shorts, TikTok) report e.g. 1080x1920; call that 1080p, not 1920p.
  const p = format.width ? Math.min(format.width, format.height) : format.height;
  if (p >= 2160) return `${p}p · 4K`;
  if (p >= 1440) return `${p}p · QHD`;
  return `${p}p`;
}

// Turns raw yt-dlp --dump-json output into the few facts the UI needs instead
// of dumping the full (often huge) raw format table.
function summarizeFormats(info) {
  const formats = Array.isArray(info.formats) && info.formats.length ? info.formats : [info];
  const video = formats.filter((f) => f.vcodec !== 'none' && f.height >= MIN_HEIGHT);

  const qualities = new Map();
  video
    .slice()
    .sort((a, b) => b.height - a.height)
    .forEach((f) => {
      if (!qualities.has(f.height)) qualities.set(f.height, qualityLabel(f));
    });

  return {
    qualities: [...qualities].map(([height, label]) => ({ height, label })),
    hasVideo: video.length > 0,
    hasVideoOnly: video.some((f) => f.acodec === 'none'),
    hasAudio: formats.some((f) => f.acodec !== 'none'),
  };
}

module.exports = { summarizeFormats };
