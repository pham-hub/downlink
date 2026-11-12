// Small helpers for reading HLS playlists.

// '#EXT-X-STREAM-INF' means a master playlist, '#EXTINF' a media playlist.
function classifyPlaylist(body) {
  if (/#EXT-X-STREAM-INF/.test(body)) return 'hls-master';
  if (/#EXTINF/.test(body)) return 'hls-media';
  return null;
}

// Total running time of a media playlist, in seconds.
function playlistDuration(body) {
  let total = 0;
  for (const m of body.matchAll(/#EXTINF:([\d.]+)/g)) total += Number(m[1]);
  return total || undefined;
}

function absolute(base, ref) {
  try {
    return new URL(ref, base).toString();
  } catch {
    return null;
  }
}

function attributes(line) {
  const out = {};
  for (const m of line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

// The variants listed by a master playlist: RESOLUTION, CODECS, BANDWIDTH, FRAME-RATE.
function parseMaster(body, baseUrl) {
  const lines = body.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const attrs = attributes(lines[i].slice('#EXT-X-STREAM-INF:'.length));
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    const [w, h] = String(attrs.RESOLUTION || '').split('x').map(Number);
    variants.push({
      url: uri ? absolute(baseUrl, uri) : null,
      width: w || undefined,
      height: h || undefined,
      bandwidth: Number(attrs.BANDWIDTH) || undefined,
      fps: Number(attrs['FRAME-RATE']) || undefined,
      codecs: attrs.CODECS || '',
    });
  }
  return variants.filter((v) => v.url);
}

module.exports = { classifyPlaylist, playlistDuration, parseMaster, absolute };
