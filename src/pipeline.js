// Runs one job's work from start to finish.
//
// Presets that don't convert (Original, Audio only original, the v1.0 MP3/M4A modes) are one
// yt-dlp run straight into the chosen folder. Converting presets are two steps: yt-dlp
// downloads the best-quality source into the job's temp folder, then ffmpeg makes the final
// file in the chosen folder (spec section 5). The intermediate source is deleted afterwards
// unless "Keep original too" is on.

const fs = require('fs');
const path = require('path');
const { startDownload } = require('./downloader');
const { runFfmpeg } = require('./ffmpeg');
const presets = require('./presets');

const PRESET_TAGS = { h264: 'H.264', prores422: 'ProRes 422', prores422hq: 'ProRes 422 HQ' };

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}.${ext}`);
  for (let n = 2; fs.existsSync(candidate); n += 1) candidate = path.join(dir, `${base} (${n}).${ext}`);
  return candidate;
}

// hooks: onProgress(progress), onComplete({ filePath, existing }), onError(raw, source), onCancel()
function startJob(options, hooks) {
  const preset = presets.PRESETS[options.preset] || presets.PRESETS.original;
  // The v1.0 audio modes (MP3, M4A) and "Audio only (original)" are all handled by yt-dlp.
  const converts = preset.convert && options.mode !== 'video';

  if (!converts) {
    return startDownload(options, {
      onProgress: hooks.onProgress,
      onComplete: hooks.onComplete,
      onError: (raw) => hooks.onError(raw, 'ytdlp'),
      onCancel: hooks.onCancel,
    });
  }

  let current = null;
  let cancelled = false;
  let partialOutput = null;

  const sourceDir = path.join(options.tempDir, 'source');
  fs.mkdirSync(sourceDir, { recursive: true });

  function finishCancelled() {
    if (partialOutput) fs.rmSync(partialOutput, { force: true });
    hooks.onCancel();
  }

  current = startDownload(
    {
      ...options,
      folder: sourceDir,
      intermediate: true,
      audioOnlySource: !!preset.audioOnly,
      // Presets that re-encode want the best source; the picker's compatible/tier choices only
      // narrow what's downloaded when the user asks for a specific height or format.
      videoCodec: 'best',
    },
    {
      onProgress: hooks.onProgress,
      onError: (raw) => hooks.onError(raw, 'ytdlp'),
      onCancel: finishCancelled,
      onComplete: async (result) => {
        if (cancelled) return finishCancelled();
        if (!result.filePath) return hooks.onError('yt-dlp did not report a file', 'ytdlp');
        try {
          await convert(result.filePath);
        } catch (err) {
          hooks.onError(err.message, 'ffmpeg');
        }
      },
    }
  );

  async function convert(sourceFile) {
    hooks.onProgress({ stage: 'processing', step: 'Convert', percent: 0 });
    const probeInfo = await presets.probe(options.ffmpegPath, sourceFile);
    // "Title (720p)_000005-000010" -> "Title (720p) (H.264)_000005-000010": the preset goes before
    // the clip range, which stays last.
    const tag = PRESET_TAGS[options.preset];
    const raw = path.basename(sourceFile, path.extname(sourceFile));
    const parts = raw.match(/^(.*?)(_\d{6}-(?:\d{6}|end))?$/);
    const base = tag ? `${parts[1]} (${tag})${parts[2] || ''}` : raw;
    const output = uniquePath(options.folder, base, preset.ext);
    partialOutput = output;
    const args = presets.buildConvertArgs({
      presetId: options.preset,
      encoders: options.encoders,
      probeInfo,
      input: sourceFile,
      output,
      stillSec: options.stillSec,
    });
    if (cancelled) return finishCancelled();
    const run = runFfmpeg({
      ffmpegPath: options.ffmpegPath,
      args,
      durationSec: preset.still ? 0 : probeInfo.durationSec,
      onProgress: (percent) => hooks.onProgress({ stage: 'processing', step: 'Convert', percent }),
    });
    current = run;
    const { code, stderr, cancelled: wasCancelled } = await run.promise;
    if (wasCancelled || cancelled) return finishCancelled();
    if (code !== 0) {
      fs.rmSync(output, { force: true });
      throw new Error(stderr || `ffmpeg exited with code ${code}`);
    }
    partialOutput = null;
    if (options.keepOriginal) {
      const kept = uniquePath(options.folder, base, path.extname(sourceFile).slice(1));
      fs.copyFileSync(sourceFile, kept);
    }
    hooks.onComplete({ filePath: output, existing: false });
  }

  return {
    cancel() {
      cancelled = true;
      if (current) current.cancel();
    },
  };
}

module.exports = { startJob };
