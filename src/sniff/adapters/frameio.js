// Frame.io share links (verified against a real share in Nov 2026).
//
// The player asks for fMP4 segments like
//   https://sahls.frame.io/encode-hls/<assetId>/token/<jwt>/<rendition>/<n>.m4s
// and the matching playlists sit next to them:
//   <base>/<rendition>/media-vid.m3u8   (video, one per rendition)
//   <base>/aac_cha2/media-aud.m3u8      (audio)
// The token is part of the URL and expires after about a day, so nothing here is ever stored;
// a re-download goes back to the share link.

const { playlistDuration } = require('../hls');

const SEGMENT = /^\/encode-hls\/([^/]+)\/token\/([^/]+)\/([^/]+)\/\d+\.m4s$/;
const RENDITIONS = ['h264_2160', 'h264_1080_best', 'h264_720', 'h264_540', 'h264_360'];
const AUDIO = 'aac_cha2';

function parts(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'sahls.frame.io') return null;
    const m = u.pathname.match(SEGMENT);
    if (!m) return null;
    return { base: `${u.origin}/encode-hls/${m[1]}/token/${m[2]}`, rendition: m[3] };
  } catch {
    return null;
  }
}

function heightOf(rendition) {
  const m = rendition.match(/_(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

// "26-27 SEA Open.mp4 - 26-27 SEA Open - Frame.io" -> "26-27 SEA Open"
function assetName(title) {
  if (!title) return undefined;
  const first = String(title).replace(/\s*[-|]\s*Frame\.io\s*$/i, '').split(/\s+-\s+/)[0].trim();
  return first.replace(/\.(mp4|mov|m4v|mxf|mkv|avi|webm)$/i, '') || undefined;
}

module.exports = {
  name: 'frameio',

  match(candidate) {
    return !!parts(candidate.url);
  },

  async resolve(candidates, ctx) {
    const hit = candidates.map((c) => ({ c, p: parts(c.url) })).find((x) => x.p);
    if (!hit) return null;
    const { base } = hit.p;
    const headers = hit.c.headers;

    // Every rendition that answers 200 is offered; the highest one is the default.
    const found = [];
    for (const rendition of RENDITIONS) {
      const url = `${base}/${rendition}/media-vid.m3u8`;
      const res = await ctx.fetch(url, headers).catch(() => null);
      if (res && res.status === 200) found.push({ rendition, url, body: await res.text() });
    }
    if (!found.length) return null;

    const audioUrl = `${base}/${AUDIO}/media-aud.m3u8`;
    const audioRes = await ctx.fetch(audioUrl, headers).catch(() => null);
    const hasAudio = !!audioRes && audioRes.status === 200;

    const durationSec = playlistDuration(found[0].body);
    const variants = found.map((f) => {
      const height = heightOf(f.rendition);
      return {
        id: f.rendition,
        url: f.url,
        height,
        width: Math.round((height * 16) / 9),
        vcodec: 'h264',
        hdr: false,
        hasAudio: false,
        label: `${height}p · H.264`,
      };
    });

    return {
      pageUrl: ctx.pageUrl,
      pageTitle: assetName(await ctx.pageTitle()),
      video: { url: found[0].url, kind: 'hls-media' },
      audio: hasAudio ? { url: audioUrl } : undefined,
      headers: ctx.headersFor(hit.c),
      variants,
      durationSec,
      posterUrl: await ctx.posterUrl(),
    };
  },
};
