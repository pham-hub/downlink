// Time entry for clip ranges and still frames (spec section 4).
// Loaded as a plain script in the window and with require() in tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timecode = factory();
})(this, function () {
  const INT = /^\d+$/;
  const SECONDS = /^\d+(\.\d+)?$/;

  // Accepts 90, 90.5, MM:SS, HH:MM:SS, HH:MM:SS.mmm and HH:MM:SS:FF (needs the frame rate).
  // Returns { value } (null when empty) or { error }.
  function parse(text, fps) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { value: null };
    if (SECONDS.test(t)) return { value: Number(t) };

    const parts = t.split(':');
    if (parts.length < 2 || parts.length > 4) return { error: 'Use times like 1:20, 1:02:30 or 90.5.' };

    let frames = 0;
    if (parts.length === 4) {
      if (!fps) return { error: 'Frame timecodes need a known frame rate for this video.' };
      const ff = parts.pop();
      if (!INT.test(ff)) return { error: 'Use times like 1:20, 1:02:30 or 90.5.' };
      frames = Number(ff);
      if (frames >= Math.ceil(fps)) return { error: `Frames go from 0 to ${Math.ceil(fps) - 1} for this video.` };
    }

    const last = parts.length - 1;
    for (let i = 0; i < parts.length; i += 1) {
      const ok = i === last ? SECONDS.test(parts[i]) : INT.test(parts[i]);
      if (!ok) return { error: 'Use times like 1:20, 1:02:30 or 90.5.' };
      if (i > 0 && Number(parts[i]) >= 60) return { error: 'Minutes and seconds go up to 59.' };
    }
    const seconds = parts.reduce((acc, v) => acc * 60 + Number(v), 0);
    return { value: seconds + (frames ? frames / fps : 0) };
  }

  // 80 -> "1:20", 3725 -> "1:02:05"
  function format(seconds) {
    if (seconds == null) return '';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  // 90 -> "000130", the form used in clip file names.
  function compact(seconds) {
    const s = Math.floor(seconds);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}${pad(Math.floor((s % 3600) / 60))}${pad(s % 60)}`;
  }

  // yt-dlp and ffmpeg both take plain seconds with three decimals.
  function seconds3(seconds) {
    return Number(seconds).toFixed(3);
  }

  return { parse, format, compact, seconds3 };
});
