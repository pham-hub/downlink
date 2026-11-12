const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --ignore-config keeps a personal ~/.config/yt-dlp/config (custom -o, -f, -k, ...)
// from changing what the app downloads or where it saves.
const BASE_ARGS = ['--ignore-config', '--no-playlist', '--no-warnings'];
const FILE_MARKER = '__VD_FILE__ ';
const PROGRESS_TEMPLATE =
  'download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s';

const AUDIO_FORMATS = {
  mp3: { selector: 'ba/b', extra: ['--audio-quality', '0'], coverArt: true },
  // Prefer an AAC source so M4A is a straight copy instead of a re-encode.
  m4a: { selector: 'ba[ext=m4a]/ba/b', extra: [], coverArt: true },
  // WAV has no standard place for cover art.
  wav: { selector: 'ba/b', extra: [], coverArt: false },
};

// Sort order per codec preference. 'best' ranks codecs the way yt-dlp does by default (AV1 > VP9 >
// H.264), but ahead of the site's own ranking, which otherwise picks H.264 at some sizes; AV1/VP9 look
// noticeably sharper at YouTube's low bitrates. 'compatible' puts H.264 ahead of resolution so
// QuickTime and older devices can always play the file, even though YouTube's H.264 stops at 1080p.
// A chosen quality is a sort preference ("res:1080": the largest at or below 1080 on the short
// side) rather than a [height<=] filter, so vertical videos and odd sizes match too.
const VIDEO_SORT = {
  best: (res) => `${res},fps,hdr:12,vcodec`,
  compatible: (res) => `vcodec:h264,${res},fps`,
};

const PROCESSING_STEPS = /^\[(Merger|ExtractAudio|VideoRemuxer|VideoConvertor|Metadata|EmbedThumbnail|ThumbnailsConvertor|FixupM3u8|FixupM4a|FixupStretched)\]/;

// yt-dlp needs a JavaScript runtime to solve YouTube's player challenges; point it at the
// app's own Deno rather than whatever might be on PATH.
function runtimeArgs(denoPath) {
  return ['--js-runtimes', `deno:${denoPath}`];
}

const FETCH_TIMEOUT = 90 * 1000;

// An error carrying the raw tool output (for the error map) or a code of the app's own.
function toolError(raw, code) {
  const err = new Error(String(raw || '').trim().split('\n').pop() || 'yt-dlp failed');
  err.raw = String(raw || '');
  if (code) err.code = code;
  return err;
}

// Reads a link's title, duration and formats without downloading anything (`yt-dlp -J`).
// --flat-playlist makes playlist and channel links return a short list right away instead of
// looking up every video in them, so they can be turned away quickly.
// The promise has a cancel() so a link the user moved on from stops loading.
function fetchInfo({ ytDlpPath, denoPath }, url) {
  let child;
  const promise = new Promise((resolve, reject) => {
    child = execFile(
      ytDlpPath,
      [...BASE_ARGS, ...runtimeArgs(denoPath), '--dump-single-json', '--flat-playlist', '--', url],
      { maxBuffer: 1024 * 1024 * 50, timeout: FETCH_TIMEOUT, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          reject(toolError('', 'RESOLVE_TIMEOUT'));
          return;
        }
        if (err) {
          reject(toolError(stderr || err.message));
          return;
        }
        let info;
        try {
          info = JSON.parse(stdout);
        } catch {
          reject(toolError(stderr, 'NO_VIDEO'));
          return;
        }
        if (info._type === 'playlist') reject(toolError('', 'PLAYLIST'));
        else if (info.is_live) reject(toolError('', 'LIVE'));
        else resolve(info);
      }
    );
  });
  promise.cancel = () => child && child.kill();
  return promise;
}

// 80 -> "1m20s", 3725 -> "1h02m05s"; used in clip file names (colons aren't Finder-friendly).
function compactTime(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  if (h) return `${h}h${String(m).padStart(2, '0')}m${sec}s`;
  if (m) return `${m}m${sec}s`;
  return `${s % 60}s`;
}

function buildArgs({ ffmpegPath, denoPath, url, folder, tempDir, mode, resolution, qualityLabel, audioFormat, videoCodec, clip }) {
  const args = [
    ...BASE_ARGS,
    ...runtimeArgs(denoPath),
    '--newline',
    '--no-quiet',
    '--print', `after_move:${FILE_MARKER}%(filepath)s`,
    // The folder, so yt-dlp also finds the ffprobe next to ffmpeg.
    '--ffmpeg-location', path.dirname(ffmpegPath),
    '--embed-metadata',
    // Progress as one machine-readable line: percent|speed|eta|size|estimated size.
    '--progress-template', PROGRESS_TEMPLATE,
    // Partial and intermediate files live in the job's temp folder; only the finished file
    // is moved into the chosen folder.
    '-P', folder,
    ...(tempDir ? ['-P', `temp:${tempDir}`] : []),
  ];
  const sort = (VIDEO_SORT[videoCodec] || VIDEO_SORT.best)(resolution ? `res:${resolution}` : 'res');
  // Non-default choices go in the file name, so e.g. a 720p H.264 copy doesn't collide with
  // (and get skipped as "already downloaded" because of) an earlier best-quality one.
  const tags = [];
  if (mode !== 'audio' && resolution && /^\d{3,4}p$/.test(qualityLabel || '')) tags.push(qualityLabel);
  if (mode !== 'audio' && videoCodec === 'compatible') tags.push('H.264');

  if (mode === 'audio') {
    const fmt = AUDIO_FORMATS[audioFormat] ? audioFormat : 'mp3';
    const spec = AUDIO_FORMATS[fmt];
    args.push('-f', spec.selector, '-x', '--audio-format', fmt, ...spec.extra);
    if (spec.coverArt) args.push('--embed-thumbnail');
  } else if (mode === 'video') {
    args.push('-f', 'bv', '-S', sort, '--remux-video', 'mp4', '--embed-thumbnail');
    tags.push('video only');
  } else {
    // AAC audio either way so the .mp4 plays in QuickTime; the video codec follows the user's preference.
    // A video-only stream plus the best audio first: with "bv*" the AAC preference would pick a combined
    // format instead (YouTube's 360p one has 96 kbps audio). Then combined formats, then silent video.
    args.push(
      '-f', 'bv+ba/b/bv*',
      '-S', `${sort},acodec:aac`,
      '--merge-output-format', 'mp4',
      '--embed-thumbnail'
    );
  }

  if (clip) {
    const start = clip.start || 0;
    const end = clip.end == null ? 'inf' : clip.end;
    // Cut on the exact times rather than the nearest keyframe/seek point (audio snaps too).
    args.push('--download-sections', `*${start}-${end}`, '--force-keyframes-at-cuts');
    // Exact cuts make ffmpeg re-encode the clip, and its defaults (x264 CRF 23, Opus at 96 kbps)
    // are visibly and audibly worse than the source. Encode close to it instead.
    const reencode = { audio: '-b:a 256k', video: '-crf 18' }[mode] || '-crf 18 -b:a 256k';
    args.push('--downloader-args', `ffmpeg_o:${reencode}`);
    tags.push(`clip ${compactTime(start)}-${clip.end == null ? 'end' : compactTime(clip.end)}`);
  }

  // macOS allows 255 bytes per file name. Cap the title in bytes (long non-English titles use 3+
  // bytes per character), leaving room for the tags and yt-dlp's temporary ".f140.m4a.part" names.
  const suffix = tags.length ? ` (${tags.join(', ')})` : '';
  // Leading dots ("...Baby One More Time") would make a file Finder hides. The file name drops them;
  // the title tag inside the file keeps them.
  args.push('--parse-metadata', '%(title)s:%(filetitle)s', '--replace-in-metadata', 'filetitle', '^[\\s.]+', '');
  args.push('-o', `%(filetitle).170B${suffix}.%(ext)s`, '--', url);
  return args;
}

function removeLeftovers(touchedPaths, startedAt) {
  touchedPaths.forEach((p) => {
    const dir = path.dirname(p);
    const base = path.basename(p);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    names
      .filter((name) => name.startsWith(base))
      .forEach((name) => {
        const full = path.join(dir, name);
        try {
          // Only remove files this download created, never something that was already there.
          if (fs.statSync(full).mtimeMs >= startedAt - 1000) fs.unlinkSync(full);
        } catch {
          // already gone
        }
      });
  });
}

// Kicks off a download and reports progress/completion through callbacks.
// Returns a handle with cancel() so the caller can stop it.
function startDownload(options, { onProgress, onComplete, onError, onCancel }) {
  const { ytDlpPath, clip, duration } = options;
  const args = buildArgs(options);
  const startedAt = Date.now();
  // The bundled static ffmpeg has no built-in certificate store, and it fetches the stream
  // itself for clips; point it at macOS's so those HTTPS requests verify.
  const IS_WIN = process.platform === 'win32';
  const env = IS_WIN ? { ...process.env } : { SSL_CERT_FILE: '/etc/ssl/cert.pem', ...process.env };
  // Own process group (macOS), so cancelling also stops the ffmpeg yt-dlp spawns. On Windows
  // taskkill /T takes down the whole tree instead, and the console window stays hidden.
  const child = spawn(ytDlpPath, args, { detached: !IS_WIN, windowsHide: true, env });

  // Unknown when the site doesn't say how long the video is and the clip runs to the end.
  const clipEnd = clip && (clip.end == null ? duration : clip.end);
  const clipLength = clipEnd ? clipEnd - (clip.start || 0) : null;
  const touched = new Set();
  let finalPath = null;
  let existing = false;
  let cancelled = false;
  let finished = false;
  let streams = 1;
  let streamIndex = 0;
  let stdoutRemainder = '';
  let stderrBuffer = '';

  function handleLine(line) {
    if (line.startsWith(FILE_MARKER)) {
      finalPath = line.slice(FILE_MARKER.length).trim();
      return;
    }
    // Same video, same options, same folder: yt-dlp keeps the file that's there.
    if (/^\[download\] .+ has already been downloaded$/.test(line)) {
      existing = true;
      return;
    }
    const formatsMatch = line.match(/Downloading \d+ format\(s\):\s*(\S+)/);
    if (formatsMatch) {
      streams = formatsMatch[1].split('+').length;
      return;
    }
    const destMatch = line.match(/^\[download\] Destination:\s*(.+)$/);
    if (destMatch) {
      touched.add(destMatch[1].trim());
      streamIndex = Math.min(streamIndex + 1, streams);
      onProgress({ stage: 'downloading', percent: 0, stream: streamIndex, streams, clip: !!clip });
      return;
    }
    const thumbMatch = line.match(/Writing video thumbnail .* to:\s*(.+)$/);
    if (thumbMatch) {
      touched.add(thumbMatch[1].trim());
      return;
    }
    const mergeMatch = line.match(/Merging formats into "(.+)"$/);
    if (mergeMatch) {
      touched.add(mergeMatch[1].replace(/(\.\w+)$/, '.temp$1'));
    }
    const progressMatch = line.match(/^\s*([\d.]+)%\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)$/);
    if (progressMatch && !clip) {
      const known = (text) => {
        const t = text.trim();
        return t && !/^(N\/A|Unknown)/i.test(t) ? t : null;
      };
      const size = known(progressMatch[4]) || (known(progressMatch[5]) ? `~${known(progressMatch[5])}` : null);
      onProgress({
        stage: 'downloading',
        percent: parseFloat(progressMatch[1]),
        size,
        speed: known(progressMatch[2]),
        eta: known(progressMatch[3]),
        stream: streamIndex || 1,
        streams,
      });
      return;
    }
    const stepMatch = line.match(PROCESSING_STEPS);
    if (stepMatch) {
      onProgress({ stage: 'processing', step: stepMatch[1] });
    }
  }

  child.stdout.on('data', (chunk) => {
    const lines = (stdoutRemainder + chunk.toString()).split('\n');
    stdoutRemainder = lines.pop();
    lines.forEach(handleLine);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer = (stderrBuffer + text).slice(-20000);
    // Clips are downloaded by ffmpeg, which reports elapsed media time instead of a percentage.
    if (clipLength > 0) {
      const times = [...text.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
      const last = times[times.length - 1];
      if (last) {
        const t = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
        onProgress({ stage: 'downloading', clip: true, percent: Math.min(100, (t / clipLength) * 100) });
      }
    }
  });

  // 'error' (yt-dlp couldn't start) can be followed by 'close'; report only once.
  child.on('error', (err) => {
    if (finished) return;
    finished = true;
    onError(err.message);
  });

  child.on('close', (code) => {
    if (finished) return;
    finished = true;
    if (stdoutRemainder) handleLine(stdoutRemainder);
    if (cancelled) {
      removeLeftovers(touched, startedAt);
      onCancel();
    } else if (code === 0) {
      onComplete({ filePath: finalPath, existing });
    } else {
      // Don't leave half-downloaded pieces or stray thumbnails behind after a failure.
      removeLeftovers(touched, startedAt);
      onError(stderrBuffer);
    }
  });

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (IS_WIN) {
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        return;
      }
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already exited
      }
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            // already exited
          }
        }
      }, 3000);
    },
  };
}

module.exports = { fetchInfo, startDownload, buildArgs };
