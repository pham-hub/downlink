// Which subtitle track Downlink offers for a link: English if there is one, else the first
// written track. Real (uploaded) subtitles come before automatic captions.

const SKIP = new Set(['live_chat']);

function keysOf(obj) {
  return Object.keys(obj || {}).filter((k) => !SKIP.has(k));
}

// Returns { lang, auto } or null. `lang` is what yt-dlp's --sub-langs expects.
function pickSubtitle(info) {
  const manual = keysOf(info && info.subtitles);
  const auto = keysOf(info && info.automatic_captions);
  const english = (list) => list.find((k) => k === 'en') || list.find((k) => /^en[-_]/i.test(k));
  const m = english(manual) || manual[0];
  if (m) return { lang: m, auto: false };
  // en-orig is the video's own language when it is English; plain "en" may be a translation.
  const a = auto.includes('en-orig') ? 'en-orig' : english(auto);
  if (a) return { lang: a, auto: true };
  return null;
}

module.exports = { pickSubtitle };
