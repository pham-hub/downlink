// Output presets (spec section 5, minus ProRes, which was dropped): what each one is, which encoder it needs, and the ffmpeg
// arguments that make it. Presets that don't convert (Original, Audio only original) are done
// by yt-dlp alone.

const { execFile } = require('child_process');
const path = require('path');

const PRESETS = {
  original: { label: 'Original', convert: false },
  h264: { label: 'H.264 MP4 (playback)', convert: true, ext: 'mp4', needs: 'h264' },
  wav: { label: 'Audio only (WAV)', convert: true, ext: 'wav', audioOnly: true },
  'audio-original': { label: 'Audio only (original)', convert: false, audioOnly: true },
};

function isPresetId(id) {
  return Object.prototype.hasOwnProperty.call(PRESETS, id);
}

// ---------- encoders ----------

let encoderCache = null;

// Runs `ffmpeg -encoders` once and remembers the answer.
function detectEncoders(ffmpegPath) {
  if (!encoderCache) {
    encoderCache = new Promise((resolve) => {
      execFile(ffmpegPath, ['-hide_banner', '-encoders'], { maxBuffer: 1024 * 1024 * 4, windowsHide: true }, (err, stdout) => {
        const names = new Set();
        if (!err) {
          String(stdout)
            .split('\n')
            .forEach((line) => {
              const m = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
              if (m) names.add(m[1]);
            });
        }
        resolve(names);
      });
    });
  }
  return encoderCache;
}

// VideoToolbox on a Mac, the software encoders anywhere else (or when VideoToolbox is missing).
function chooseEncoders(names) {
  const mac = process.platform === 'darwin';
  const pick = (...candidates) => candidates.find((c) => names.has(c) && (mac || !/videotoolbox/.test(c))) || null;
  return {
    h264: pick('h264_videotoolbox', 'libx264'),
  };
}

// The presets this machine can make; the rest are hidden.
function availablePresets(encoders) {
  return Object.keys(PRESETS).filter((id) => {
    const needs = PRESETS[id].needs;
    return !needs || !!encoders[needs];
  });
}

// ---------- probing ----------

function ffprobePathFor(ffmpegPath) {
  return path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
}

function parseRate(rate) {
  const [n, d] = String(rate || '').split('/').map(Number);
  return n && d ? n / d : n || undefined;
}

// What the converter needs to know about the downloaded file.
function probe(ffmpegPath, file) {
  return new Promise((resolve) => {
    execFile(
      ffprobePathFor(ffmpegPath),
      ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,bit_rate,color_primaries,color_transfer,color_space:format=duration,bit_rate', '-of', 'json', file],
      { maxBuffer: 1024 * 1024 * 4, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({});
        try {
          const json = JSON.parse(stdout);
          const v = (json.streams || []).find((s) => s.codec_type === 'video') || {};
          const hasAudio = (json.streams || []).some((s) => s.codec_type === 'audio');
          const known = (x) => (x && !/^(unknown|reserved)/i.test(x) ? x : undefined);
          resolve({
            width: v.width,
            height: v.height,
            fps: parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate),
            bitRate: Number(v.bit_rate || (json.format && json.format.bit_rate)) || undefined,
            durationSec: Number(json.format && json.format.duration) || undefined,
            primaries: known(v.color_primaries),
            trc: known(v.color_transfer),
            space: known(v.color_space),
            hasAudio,
          });
        } catch {
          resolve({});
        }
      }
    );
  });
}

// ---------- ffmpeg arguments ----------

function evenScale(probeInfo) {
  const odd = (probeInfo.width && probeInfo.width % 2) || (probeInfo.height && probeInfo.height % 2);
  return odd ? ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'] : [];
}

function colorTags(probeInfo) {
  const args = [];
  if (probeInfo.primaries) args.push('-color_primaries', probeInfo.primaries);
  if (probeInfo.trc) args.push('-color_trc', probeInfo.trc);
  if (probeInfo.space) args.push('-colorspace', probeInfo.space);
  return args;
}

// Source-matched bitrate for the hardware H.264 encoder, with sensible floors.
function matchedBitrate(probeInfo) {
  const pixels = (probeInfo.width || 1920) * (probeInfo.height || 1080);
  const floor = Math.max(6e6, (pixels / (1920 * 1080)) * 12e6);
  return Math.round(Math.max(probeInfo.bitRate || 0, floor));
}

// Arguments for the second step: source file in, preset file out.
function buildConvertArgs({ presetId, encoders, probeInfo = {}, input, output }) {
  const base = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats'];

  if (presetId === 'wav') {
    return [...base, '-i', input, '-vn', '-map', '0:a:0', '-c:a', 'pcm_s24le', '-ar', '48000', output];
  }
  if (presetId === 'h264') {
    const video =
      encoders.h264 === 'h264_videotoolbox'
        ? ['-c:v', 'h264_videotoolbox', '-b:v', String(matchedBitrate(probeInfo))]
        : ['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast'];
    return [
      ...base, '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...video,
      '-pix_fmt', 'yuv420p',
      ...evenScale(probeInfo),
      ...colorTags(probeInfo),
      '-map', '0:s?', '-c:s', 'mov_text',
      '-c:a', 'aac', '-b:a', '320k',
      '-movflags', '+faststart',
      output,
    ];
  }
  throw new Error(`No converter for ${presetId}`);
}

// Audio from a sniffed file: MP3 is encoded, M4A and "original" keep the AAC as it is.
function buildAudioExtractArgs({ format, input, output }) {
  const base = ['-hide_banner', '-y', '-nostdin', '-progress', 'pipe:1', '-nostats', '-i', input, '-vn', '-map', '0:a:0'];
  if (format === 'mp3') return [...base, '-c:a', 'libmp3lame', '-q:a', '0', output];
  return [...base, '-c:a', 'copy', output];
}

module.exports = {
  PRESETS,
  buildAudioExtractArgs,
  isPresetId,
  detectEncoders,
  chooseEncoders,
  availablePresets,
  probe,
  buildConvertArgs,
};
