// Downloads a captured stream whose video and audio are separate playlists (Frame.io), with
// ffmpeg directly (spec section 1). Everything else captured goes through yt-dlp.

const fs = require('fs');
const path = require('path');
const { runFfmpeg } = require('../ffmpeg');
const Timecode = require('../../renderer/timecode');

function safeName(title) {
  const cleaned = String(title || 'Video')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^[\s.]+/, '')
    .trim();
  // Keep well inside the 255-byte file name limit.
  let out = cleaned || 'Video';
  while (Buffer.byteLength(out) > 170) out = out.slice(0, -1);
  return out;
}

// "-headers" takes CRLF-separated lines, once per input.
function headerBlock(headers) {
  const lines = [];
  if (headers.referer) lines.push(`Referer: ${headers.referer}`);
  if (headers.origin) lines.push(`Origin: ${headers.origin}`);
  if (headers.cookie) lines.push(`Cookie: ${headers.cookie}`);
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

// options: { sniff, videoUrl, folder, title, tag, clip, accurate, durationSec, ffmpegPath, encoders }
// hooks: onProgress, onComplete({ filePath }), onError(raw, 'ffmpeg'), onCancel
function startSniffSource(options, hooks) {
  const { sniff, clip, accurate, encoders } = options;
  const headers = sniff.headers || {};
  const start = clip ? clip.start || 0 : 0;
  const stop = clip && clip.end != null ? clip.end : null;
  const clipSuffix = clip ? `_${Timecode.compact(start)}-${Timecode.compact(stop != null ? stop : options.durationSec || 0)}` : '';
  fs.mkdirSync(options.folder, { recursive: true });
  const output = path.join(options.folder, `${safeName(options.title)}${options.tag ? ` (${options.tag})` : ''}${clipSuffix}.mp4`);

  const input = (url) => {
    const args = [];
    if (clip) {
      args.push('-ss', Timecode.seconds3(start));
      // Fast cut: "-to" on the input side too. Accurate cut: the length goes on the output below.
      if (!accurate && stop != null) args.push('-to', Timecode.seconds3(stop));
    }
    const block = headerBlock(headers);
    if (block) args.push('-headers', block);
    if (headers.userAgent) args.push('-user_agent', headers.userAgent);
    args.push('-i', url);
    return args;
  };

  const args = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats', ...input(options.videoUrl)];
  if (sniff.audio) args.push(...input(sniff.audio.url));
  args.push('-map', '0:v:0', ...(sniff.audio ? ['-map', '1:a:0'] : ['-map', '0:a:0?']));

  if (accurate && clip) {
    // Frame-accurate: re-encode the clip (H.264 near the source quality) instead of copying.
    if (stop != null) args.push('-t', Timecode.seconds3(stop - start));
    args.push(
      ...(encoders && encoders.h264 === 'h264_videotoolbox'
        ? ['-c:v', 'h264_videotoolbox', '-b:v', '40M']
        : ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast']),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k'
    );
  } else {
    args.push('-c', 'copy');
  }
  args.push('-movflags', '+faststart', output);

  const clipLength = clip ? (stop != null ? stop : options.durationSec || 0) - start : options.durationSec;
  const run = runFfmpeg({
    ffmpegPath: options.ffmpegPath,
    args,
    durationSec: clipLength,
    onProgress: (percent) => hooks.onProgress({ stage: 'downloading', percent, clip: !!clip }),
  });
  hooks.onProgress({ stage: 'downloading', percent: 0, clip: !!clip });

  run.promise.then(({ code, stderr, cancelled }) => {
    if (cancelled) {
      fs.rmSync(output, { force: true });
      return hooks.onCancel();
    }
    if (code !== 0) {
      fs.rmSync(output, { force: true });
      // 403s from an expired token are told apart from converter trouble by the message.
      return hooks.onError(stderr || `ffmpeg exited with code ${code}`, /403|Forbidden|Server returned 4/i.test(stderr) ? 'sniff-http' : 'ffmpeg');
    }
    hooks.onComplete({ filePath: output, existing: false });
  });

  return { cancel: run.cancel };
}

module.exports = { startSniffSource, safeName };
