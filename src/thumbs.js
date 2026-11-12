// Thumbnails (spec section 9) for files yt-dlp didn't make itself: conversions and captured
// streams. yt-dlp's own path saves and embeds with --write-thumbnail / --embed-thumbnail.
//
// A cover image comes from the site (video poster, og:image) when there is one, else from a
// frame at 10% of the video. Embedding works in MP4, M4A, MP3 and MKV; MOV (ProRes) and WAV
// have no place for cover art.

const fs = require('fs');
const path = require('path');
const { runFfmpeg } = require('./ffmpeg');
const presets = require('./presets');

const EMBEDDABLE = new Set(['.mp4', '.m4v', '.m4a', '.mp3', '.mkv']);

function canEmbed(file) {
  return EMBEDDABLE.has(path.extname(file).toLowerCase());
}

async function ffmpeg(ffmpegPath, args) {
  const { code, stderr } = await runFfmpeg({ ffmpegPath, args: ['-hide_banner', '-y', '-nostdin', ...args] }).promise;
  if (code !== 0) throw new Error(stderr || `ffmpeg exited with code ${code}`);
}

async function downloadImage(url, headers, dest) {
  const h = { 'User-Agent': headers.userAgent || 'Mozilla/5.0' };
  if (headers.referer) h.Referer = headers.referer;
  if (headers.origin) h.Origin = headers.origin;
  const res = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`thumbnail HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Returns the path of a JPEG cover image in `dir`, or null if none could be made.
async function makeCover({ ffmpegPath, dir, imageUrl, headers = {}, video, durationSec }) {
  fs.mkdirSync(dir, { recursive: true });
  const jpg = path.join(dir, 'cover.jpg');
  if (imageUrl && /^https?:/i.test(imageUrl)) {
    try {
      const raw = path.join(dir, 'cover.src');
      await downloadImage(imageUrl, headers, raw);
      await ffmpeg(ffmpegPath, ['-i', raw, '-frames:v', '1', '-q:v', '2', jpg]);
      return jpg;
    } catch {
      // fall through to a frame from the video
    }
  }
  if (!video) return null;
  try {
    const duration = durationSec || (await presets.probe(ffmpegPath, video)).durationSec || 0;
    await ffmpeg(ffmpegPath, ['-ss', String((duration * 0.1).toFixed(3)), '-i', video, '-frames:v', '1', '-q:v', '2', jpg]);
    return fs.existsSync(jpg) ? jpg : null;
  } catch {
    return null;
  }
}

// ffmpeg -i video.mp4 -i thumb.jpg -map 0 -map 1 -c copy -disposition:v:1 attached_pic out.mp4
async function embedCover({ ffmpegPath, file, cover }) {
  if (!canEmbed(file)) return false;
  const ext = path.extname(file);
  const out = `${file}.embedding${ext}`;
  const videoStreams = await countVideoStreams(ffmpegPath, file);
  const args = ['-i', file, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', `-disposition:v:${videoStreams}`, 'attached_pic'];
  if (ext.toLowerCase() === '.mp3') args.push('-id3v2_version', '3');
  args.push(out);
  try {
    await ffmpeg(ffmpegPath, args);
    fs.renameSync(out, file);
    return true;
  } catch {
    fs.rmSync(out, { force: true });
    return false;
  }
}

async function countVideoStreams(ffmpegPath, file) {
  const info = await presets.probe(ffmpegPath, file);
  return info.width ? 1 : 0;
}

// The saved copy next to the video: "<output name>.jpg".
function saveNextTo(cover, file) {
  const dest = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.jpg`);
  fs.copyFileSync(cover, dest);
  return dest;
}

// 320 px wide copy for the History list.
async function makeSmall({ ffmpegPath, cover, dest }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await ffmpeg(ffmpegPath, ['-i', cover, '-vf', 'scale=320:-2', '-q:v', '4', dest]);
  return dest;
}

module.exports = { makeCover, embedCover, saveNextTo, makeSmall, canEmbed };
