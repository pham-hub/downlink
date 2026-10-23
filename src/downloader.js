const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// --ignore-config keeps a personal ~/.config/yt-dlp/config (custom -o, -f, -k, ...)
// from changing what the app downloads or where it saves.
const BASE_ARGS = ['--ignore-config', '--no-playlist', '--no-warnings'];
const FILE_MARKER = '__VD_FILE__ ';

const AUDIO_FORMATS = {
  mp3: { selector: 'ba/b', extra: ['--audio-quality', '0'], coverArt: true },
  // Prefer an AAC source so M4A is a straight copy instead of a re-encode.
  m4a: { selector: 'ba[ext=m4a]/ba/b', extra: [], coverArt: true },
  // WAV has no standard place for cover art.
  wav: { selector: 'ba/b', extra: [], coverArt: false },
};

// Sort order per codec preference. 'best' keeps yt-dlp's default codec ranking (AV1 > VP9 > H.264),
// which looks noticeably sharper at YouTube's low bitrates; 'compatible' forces H.264 so QuickTime and
// older devices can always play the file.
const VIDEO_SORT = {
  best: 'res,fps',
  compatible: 'res,fps,vcodec:h264',
};

const PROCESSING_STEPS = /^\[(Merger|ExtractAudio|VideoRemuxer|VideoConvertor|Metadata|EmbedThumbnail|ThumbnailsConvertor|FixupM3u8|FixupM4a|FixupStretched)\]/;

// yt-dlp needs a JavaScript runtime to solve YouTube's player challenges; point it at the
// app's own Deno rather than whatever might be on PATH.
function runtimeArgs(denoPath) {
  return ['--js-runtimes', `deno:${denoPath}`];
}

const FETCH_TIMEOUT = 90 * 1000;

// Reads a link's title, duration and formats without downloading anything.
// --flat-playlist makes playlist and channel links return a short list right away instead of
// looking up every video in them, so they can be turned away quickly.
function fetchInfo({ ytDlpPath, denoPath }, url) {
  return new Promise((resolve, reject) => {
    execFile(
      ytDlpPath,
      [...BASE_ARGS, ...runtimeArgs(denoPath), '--dump-single-json', '--flat-playlist', '--', url],
      { maxBuffer: 1024 * 1024 * 50, timeout: FETCH_TIMEOUT },
      (err, stdout, stderr) => {
        if (err && err.killed) {
          reject(new Error('This link took too long to load. Check it and your connection, then try again.'));
          return;
        }
        if (err) {
          reject(new Error(mapErrorMessage(stderr || err.message)));
          return;
        }
        let info;
        try {
          info = JSON.parse(stdout);
        } catch {
          reject(new Error('Could not read video information for this URL.'));
          return;
        }
        if (info._type === 'playlist') {
          reject(new Error("That's a playlist or channel link. Open a single video and paste its link."));
        } else if (info.is_live) {
          reject(new Error("This is a live stream. It can be downloaded once it's over."));
        } else {
          resolve(info);
        }
      }
    );
  });
}

// Turns yt-dlp's error output into one plain sentence. Checked in order; the first match wins.
const ERROR_MESSAGES = [
  [/Unsupported URL/i, "This site or link isn't supported."],
  [/is not a valid URL|Incomplete YouTube ID/i, "That doesn't look like a valid video link."],
  [/No space left on device|ENOSPC/i, 'Not enough disk space to complete this download.'],
  [/Permission denied|Operation not permitted|EACCES|EPERM|Read-only file system/i, "Can't save to that folder. Choose a different one."],
  [/not a bot/i, "YouTube wants to confirm you're not a bot. Wait a few minutes and try again."],
  [/Private video|Sign in to confirm your age|This video is unavailable|Video unavailable/i, 'This video is private, age-restricted, or unavailable.'],
  [/logged-in|--cookies|\blogin required\b|\blog in\b|\bsign in\b/i, 'This site only allows downloads when signed in, which the app doesn\'t support.'],
  [/Premieres in|live event will begin|This live event/i, "This video hasn't started yet."],
  [/Requested format is not available/i, "That quality isn't available for this video. Try Best available."],
  [/HTTP Error 429/i, 'The site is limiting requests. Wait a few minutes and try again.'],
  [/HTTP Error 403/i, 'The site refused the download (HTTP 403). Try again in a few minutes.'],
  [/HTTP Error 404|: Not found/i, "That video wasn't found. Check the link."],
  [/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|nodename nor servname|Failed to resolve|Unable to connect|Connection refused|Network is unreachable|timed out|Temporary failure in name resolution/i,
    'Network error. Check your internet connection and try again.'],
];

function mapErrorMessage(raw) {
  const text = String(raw || '');
  const known = ERROR_MESSAGES.find(([pattern]) => pattern.test(text));
  if (known) return known[1];
  // Otherwise show yt-dlp's own last error, minus its "ERROR: [site] id:" prefix.
  const lines = text.trim().split('\n').filter(Boolean);
  const errorLine = lines.filter((l) => l.startsWith('ERROR:')).pop();
  const last = errorLine || lines[lines.length - 1] || 'yt-dlp failed to process this URL.';
  return last.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:\s]+:\s*/, '');
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

function buildArgs({ ffmpegPath, denoPath, url, folder, mode, height, qualityLabel, audioFormat, videoCodec, clip }) {
  const args = [
    ...BASE_ARGS,
    ...runtimeArgs(denoPath),
    '--newline',
    '--no-quiet',
    '--print', `after_move:${FILE_MARKER}%(filepath)s`,
    // The folder, so yt-dlp also finds the ffprobe next to ffmpeg.
    '--ffmpeg-location', path.dirname(ffmpegPath),
    '--embed-metadata',
    '-P', folder,
  ];
  const limit = height ? `[height<=${height}]` : '';
  const sort = VIDEO_SORT[videoCodec] || VIDEO_SORT.best;
  // Non-default choices go in the file name, so e.g. a 720p H.264 copy doesn't collide with
  // (and get skipped as "already downloaded" because of) an earlier best-quality one.
  const tags = [];
  if (mode !== 'audio' && height && /^\d{3,4}p$/.test(qualityLabel || '')) tags.push(qualityLabel);
  if (mode !== 'audio' && videoCodec === 'compatible') tags.push('H.264');

  if (mode === 'audio') {
    const fmt = AUDIO_FORMATS[audioFormat] ? audioFormat : 'mp3';
    const spec = AUDIO_FORMATS[fmt];
    args.push('-f', spec.selector, '-x', '--audio-format', fmt, ...spec.extra);
    if (spec.coverArt) args.push('--embed-thumbnail');
  } else if (mode === 'video') {
    args.push('-f', `bv${limit}/bv`, '-S', sort, '--remux-video', 'mp4', '--embed-thumbnail');
    tags.push('video only');
  } else {
    // AAC audio either way so the .mp4 plays in QuickTime; the video codec follows the user's preference.
    args.push(
      '-f', `bv*${limit}+ba/b${limit}/b`,
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
    tags.push(`clip ${compactTime(start)}-${clip.end == null ? 'end' : compactTime(clip.end)}`);
  }

  // macOS allows 255 bytes per file name. Cap the title in bytes (long non-English titles use 3+
  // bytes per character), leaving room for the tags and yt-dlp's temporary ".f140.m4a.part" names.
  const suffix = tags.length ? ` (${tags.join(', ')})` : '';
  args.push('-o', `%(title).170B${suffix}.%(ext)s`, '--', url);
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
  const env = { SSL_CERT_FILE: '/etc/ssl/cert.pem', ...process.env };
  // Own process group, so cancelling also stops the ffmpeg yt-dlp spawns.
  const child = spawn(ytDlpPath, args, { detached: true, env });

  const clipLength = clip ? (clip.end == null ? duration : clip.end) - (clip.start || 0) : null;
  const touched = new Set();
  let finalPath = null;
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
    const progressMatch = line.match(/^\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*([\d.]+\w+))?(?:\s+at\s+([\d.]+\w+\/s|Unknown speed))?(?:\s+ETA\s+([\d:]+|Unknown))?/);
    if (progressMatch && !clip) {
      onProgress({
        stage: 'downloading',
        percent: parseFloat(progressMatch[1]),
        size: progressMatch[2] || null,
        speed: progressMatch[3] && !/Unknown/.test(progressMatch[3]) ? progressMatch[3] : null,
        eta: progressMatch[4] && !/Unknown/.test(progressMatch[4]) ? progressMatch[4] : null,
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
    if (clipLength) {
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
    onError(mapErrorMessage(err.message));
  });

  child.on('close', (code) => {
    if (finished) return;
    finished = true;
    if (stdoutRemainder) handleLine(stdoutRemainder);
    if (cancelled) {
      removeLeftovers(touched, startedAt);
      onCancel();
    } else if (code === 0) {
      onComplete({ filePath: finalPath });
    } else {
      // Don't leave half-downloaded pieces or stray thumbnails behind after a failure.
      removeLeftovers(touched, startedAt);
      onError(mapErrorMessage(stderrBuffer));
    }
  });

  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      try {
        process.kill(-child.pid, 'SIGINT');
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

module.exports = { fetchInfo, startDownload, mapErrorMessage, buildArgs };
