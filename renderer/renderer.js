const $ = (id) => document.getElementById(id);

const appRoot = $('app');
const mainScreen = $('main-screen');

const urlForm = $('url-form');
const urlInput = $('url-input');
const fetchBtn = $('fetch-btn');
const preview = $('preview');
const previewThumb = $('preview-thumb');
const previewTitle = $('preview-title');
const previewSub = $('preview-sub');
const previewError = $('preview-error');

const optionsCard = $('options');
const modeControl = $('mode-control');
const audioField = $('audio-field');
const audioControl = $('audio-control');
const audioHint = $('audio-hint');
const clipToggle = $('clip-toggle');
const clipFields = $('clip-fields');
const clipStart = $('clip-start');
const clipEnd = $('clip-end');
const clipLength = $('clip-length');
const clipError = $('clip-error');
const clipMore = $('clip-more');
const clipAccurate = $('clip-accurate');
const clipField = $('clip-field');
const presetField = $('preset-field');
const subsField = $('subs-field');
const subsSelect = $('subs-select');
const convertToggle = $('convert-toggle');
const planSummary = $('plan-summary');
const folderPathEl = $('folder-path');

const downloadBtn = $('download-btn');
const progressCard = $('progress');
const progressStage = $('progress-stage');
const progressPercent = $('progress-percent');
const progressTrack = progressCard.querySelector('.progress-track');
const progressFill = $('progress-fill');
const progressDetail = $('progress-detail');
const cancelBtn = $('cancel-btn');
const resultCard = $('result');
const resultFile = $('result-file');
const statusEl = $('status');
const footer = $('footer');

const AUDIO_HINTS = {
  mp3: 'Plays everywhere. Cover art and tags included.',
  m4a: 'Better quality at the same size, native on Apple devices. Cover art and tags included.',
  wav: 'Uncompressed 24-bit, 48 kHz. Large. Best for editing. Title and artist tags only.',
  original: 'No conversion. Keeps the audio exactly as the site serves it.',
};

const STEP_LABELS = {
  Merger: 'Merging video and audio…',
  ExtractAudio: 'Converting audio…',
  VideoRemuxer: 'Packaging as MP4…',
  VideoConvertor: 'Converting video…',
  Metadata: 'Adding title and tags…',
  ThumbnailsConvertor: 'Adding cover art…',
  EmbedThumbnail: 'Adding cover art…',
  FixupM3u8: 'Finishing up…',
  FixupM4a: 'Finishing up…',
  FixupStretched: 'Finishing up…',
};

const state = {
  settings: { mode: 'both', audioFormat: 'mp3', lastFolder: null },
  info: null,
  preset: 'original', // what will run: 'original' unless Convert is on
  convertOn: false,
  presets: [{ id: 'original', label: 'Original' }],
  formats: null,
  fetchedUrl: null,
  jobId: null,
  passwordJob: null,
  screen: 'main',
  pendingRedownload: null,
  autoStart: false,
  downloading: false,
  cancelling: false,
  lastFile: null,
};

/* ---------- helpers ---------- */

function show(el, visible) {
  el.classList.toggle('hidden', !visible);
}

const formatDuration = Timecode.format;

// "youtube.com/watch?v=…" pasted without the https:// part still works.
function normalizeUrl(text) {
  const t = text.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(t) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)) return `https://${t}`;
  return t;
}

function displayFolder(folder) {
  if (!folder) return 'Choose a folder';
  const home = folder.match(/^\/Users\/[^/]+/);
  return home ? `~${folder.slice(home[0].length)}` : folder;
}

function setStatus(message, type = 'error') {
  statusEl.textContent = message;
  statusEl.className = `notice ${type}`;
}

function clearStatus() {
  statusEl.textContent = '';
  show(statusEl, false);
}

// A failed job: one plain sentence, an optional action, and the raw output behind Details.
function renderError(container, error, { retry } = {}) {
  container.textContent = '';
  container.className = 'notice error';
  const message = document.createElement('div');
  message.className = 'notice-message';
  message.textContent = error.message;
  container.appendChild(message);

  const row = document.createElement('div');
  row.className = 'notice-actions';
  if (error.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small btn-secondary';
    btn.textContent = error.action.label;
    btn.addEventListener('click', () => runErrorAction(error.action.id, retry));
    row.appendChild(btn);
  }
  if (error.details) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-small btn-ghost';
    toggle.textContent = 'Details';
    toggle.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'details hidden';
    const pre = document.createElement('pre');
    pre.textContent = error.details;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-small btn-ghost';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(error.details);
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    });
    panel.append(pre, copy);
    toggle.addEventListener('click', () => {
      const open = panel.classList.contains('hidden');
      show(panel, open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    row.appendChild(toggle);
    container.append(row, panel);
  } else if (row.children.length) {
    container.appendChild(row);
  }
  show(container, true);
}

async function runErrorAction(id, retry) {
  if (id === 'show-page') {
    state.showPageNext = true;
    if (retry) retry();
  } else if (id === 'show-folder') {
    window.api.openFolder();
  } else if (id === 'enable-sniff') {
    saveSetting('sniffFallback', true);
    if (retry) retry();
  } else if (id === 'retry-original') {
    saveSetting('defaultPreset', 'original');
    if (retry) retry();
  } else if (retry) {
    retry();
  }
}

function saveSetting(key, value) {
  state.settings[key] = value;
  window.api.saveSettings({ [key]: value });
}

if (/Win/.test(navigator.platform)) document.documentElement.dataset.win = '';

/* ---------- settings ---------- */

const settingsScreen = $('settings-screen');
const historyScreen = $('history-screen');

function showScreen(name) {
  show(mainScreen, name === 'main');
  show(settingsScreen, name === 'settings');
  show(historyScreen, name === 'history');
  state.screen = name;
}

function openSettings() {
  $('set-keep').checked = !!state.settings.keepOriginal;
  $('set-update').checked = state.settings.autoUpdate !== false;
  $('set-sniff').checked = state.settings.sniffFallback !== false;
  $('set-clipboard').value = state.settings.clipboardWatch || 'on-focus';
  showScreen('settings');
}

$('settings-btn').addEventListener('click', () => (state.screen === 'settings' ? showScreen('main') : openSettings()));
$('settings-done').addEventListener('click', () => showScreen('main'));
$('set-sniff').addEventListener('change', (e) => saveSetting('sniffFallback', e.target.checked));
$('set-clipboard').addEventListener('change', (e) => saveSetting('clipboardWatch', e.target.value));
$('set-keep').addEventListener('change', (e) => saveSetting('keepOriginal', e.target.checked));
$('set-update').addEventListener('change', (e) => saveSetting('autoUpdate', e.target.checked));

// A downloaded update waits behind a small notice; it also installs on its own at quit.
function showUpdate(update) {
  if (!update) return;
  $('update-version').textContent = update.version;
  show($('update-banner'), true);
}
window.api.onUpdateReady(showUpdate);
window.api.getPendingUpdate().then(showUpdate);
$('update-restart').addEventListener('click', () => window.api.installUpdate());
$('update-later').addEventListener('click', () => show($('update-banner'), false));
$('clear-history-btn').addEventListener('click', async () => {
  if (await window.api.history.clear()) renderHistory();
});

/* ---------- clipboard banner ---------- */

const clipBanner = $('clip-banner');
let offeredLink = null;

window.api.onClipboardOffer(({ url, host }) => {
  if (state.downloading) return;
  offeredLink = url;
  $('clip-banner-host').textContent = host;
  clipBanner.title = '';
  show(clipBanner, true);
});

$('clip-banner-dismiss').addEventListener('click', () => {
  offeredLink = null;
  show(clipBanner, false);
});

// Download: a job with the default preset and quality, started as soon as the link has loaded.
$('clip-banner-go').addEventListener('click', () => {
  const url = offeredLink;
  offeredLink = null;
  show(clipBanner, false);
  if (!url || state.downloading) return;
  showScreen('main');
  state.autoStart = true;
  urlInput.value = url;
  urlForm.requestSubmit();
});

/* ---------- history ---------- */

const historySearch = $('history-search');
const historyList = $('history-list');
const thumbCache = new Map();
let historyTimer = null;

function formatSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function presetLabel(entry) {
  if (entry.mode === 'audio') return entry.audioFormat ? entry.audioFormat.toUpperCase() : 'Audio';
  const found = state.presets.find((p) => p.id === entry.preset);
  return found ? found.label.replace(/ \(.*\)$/, '') : '';
}

async function loadThumb(img, id) {
  if (!thumbCache.has(id)) thumbCache.set(id, window.api.history.thumb(id));
  const url = await thumbCache.get(id);
  if (url) img.src = url;
}

function historyAction(label, handler, disabled) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-small btn-ghost';
  btn.textContent = label;
  btn.disabled = !!disabled;
  btn.addEventListener('click', handler);
  return btn;
}

function historyRow(entry) {
  const row = document.createElement('div');
  row.className = 'history-row';

  const thumb = document.createElement('div');
  thumb.className = 'history-thumb';
  if (entry.hasThumb) {
    const img = document.createElement('img');
    img.alt = '';
    thumb.appendChild(img);
    loadThumb(img, entry.id);
  }

  const body = document.createElement('div');
  body.className = 'history-body';
  const title = document.createElement('div');
  title.className = 'history-title';
  title.textContent = entry.title || entry.sourceUrl;
  title.title = entry.title || '';
  const meta = document.createElement('div');
  meta.className = 'history-meta';
  const date = new Date(entry.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (entry.status === 'failed') {
    meta.textContent = [entry.site, date, 'Failed'].join(' · ');
    meta.classList.add('is-failed');
  } else if (!entry.fileExists) {
    meta.textContent = [entry.site, date, 'File moved or deleted'].join(' · ');
  } else {
    meta.textContent = [entry.site, date, formatSize(entry.bytes), presetLabel(entry)].filter(Boolean).join(' · ');
  }

  const actions = document.createElement('div');
  actions.className = 'history-actions';
  const gone = entry.status === 'failed' || !entry.fileExists;
  actions.append(
    historyAction('Show in ' + (/Win/.test(navigator.platform) ? 'Explorer' : 'Finder'), () => window.api.history.show(entry.id), gone),
    historyAction('Open', () => window.api.history.open(entry.id), gone),
    historyAction('Re-download', () => redownload(entry)),
    historyAction('Copy link', () => window.api.history.copyLink(entry.id)),
    historyAction('Remove', async () => {
      await window.api.history.remove(entry.id);
      renderHistory();
    })
  );
  body.append(title, meta, actions);
  row.append(thumb, body);
  return row;
}

async function renderHistory() {
  const entries = await window.api.history.list(historySearch.value);
  historyList.textContent = '';
  entries.slice(0, 300).forEach((entry) => historyList.appendChild(historyRow(entry)));
  const empty = $('history-empty');
  empty.textContent = historySearch.value.trim() ? 'No matches' : 'Nothing here yet';
  show(empty, entries.length === 0);
}

$('history-btn').addEventListener('click', () => {
  if (state.screen === 'history') return showScreen('main');
  showScreen('history');
  renderHistory();
});
historySearch.addEventListener('input', () => {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(renderHistory, 120);
});

// A new job with the same link and options. Captured streams are captured again from the page,
// and a password-protected video asks for its password again.
function redownload(entry) {
  if (state.downloading) return;
  showScreen('main');
  state.pendingRedownload = entry;
  urlInput.value = entry.sourceUrl;
  urlForm.requestSubmit();
}

function applyRedownload(entry) {
  state.pendingRedownload = null;
  if (entry.mode) state.settings.mode = entry.mode;
  if (entry.audioFormat) state.settings.audioFormat = entry.audioFormat;
  state.convertOn = entry.preset === 'h264';
  renderOptions();
  if (entry.clip) {
    clipToggle.checked = true;
    clipStart.value = Timecode.format(entry.clip.startSec);
    clipEnd.value = Timecode.format(entry.clip.endSec);
    renderOptions();
  }
}

/* ---------- window sizing ---------- */

new ResizeObserver(() => {
  window.api.resizeToContent(appRoot.getBoundingClientRect().height);
}).observe(appRoot);

/* ---------- main ---------- */

async function initMain() {
  show(mainScreen, true);
  state.settings = await window.api.getSettings();
  folderPathEl.textContent = displayFolder(state.settings.lastFolder);
  folderPathEl.title = state.settings.lastFolder || '';
  loadPresets();
  renderOptions();
  urlInput.focus();
  renderToolVersions(await window.api.getToolVersions());
}

/* ---------- tool versions ---------- */

// yt-dlp and Deno update themselves in the background; the footer just shows what's in use.
function renderToolVersions(versions) {
  if (!versions) return;
  footer.textContent = [
    versions.ytDlp && `yt-dlp ${versions.ytDlp}`,
    versions.deno && `Deno ${versions.deno}`,
    versions.ffmpeg && `ffmpeg ${versions.ffmpeg}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

window.api.onToolsUpdated(renderToolVersions);

/* ---------- fetching ---------- */

function resetPreview() {
  if (state.jobId && !state.downloading) window.api.discardJob(state.jobId);
  if (state.passwordJob) {
    window.api.discardJob(state.passwordJob.id);
    hidePasswordPrompt();
  }
  state.jobId = null;
  state.info = null;
  state.formats = null;
  state.fetchedUrl = null;
  preview.className = 'card preview is-empty';
  previewThumb.style.backgroundImage = '';
  previewThumb.classList.remove('has-image');
  previewThumb.querySelector('.duration-badge')?.remove();
  previewTitle.textContent = 'Nothing loaded yet';
  previewSub.textContent = 'Paste or drop a link from YouTube, TikTok, SoundCloud, or most other video sites.';
  renderOptions();
}

function renderPreview(info) {
  preview.className = 'card preview';
  previewTitle.textContent = info.title || 'Untitled';
  previewTitle.title = info.title || '';
  previewSub.textContent = [info.uploader, info.site].filter(Boolean).join(' · ');
  previewThumb.querySelector('.duration-badge')?.remove();
  if (info.thumbnail) {
    previewThumb.style.backgroundImage = `url("${info.thumbnail.replace(/"/g, '%22')}")`;
    previewThumb.classList.add('has-image');
  }
  if (info.duration) {
    const badge = document.createElement('span');
    badge.className = 'duration-badge';
    badge.textContent = formatDuration(info.duration);
    previewThumb.appendChild(badge);
  }
}

urlForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = normalizeUrl(urlInput.value);
  urlInput.value = url;
  clearStatus();
  show(previewError, false);
  show(resultCard, false);
  if (!url) {
    urlInput.focus();
    return;
  }

  resetPreview();
  preview.className = 'card preview is-loading';
  previewTitle.textContent = 'Loading video details';
  previewSub.textContent = 'Loading';
  setFetching(true);

  const showPage = state.showPageNext;
  state.showPageNext = false;
  await settleFetch(window.api.fetchInfo(url, showPage ? { showPage: true } : undefined), url);
});

function setFetching(on) {
  fetchBtn.disabled = on;
  show(fetchBtn.querySelector('.spinner'), on);
  show(fetchBtn.querySelector('.label'), !on);
}

// Handles what came back for a link: a loaded video, a password to ask for, or an error.
async function settleFetch(pending, url) {
  const result = await pending;
  // A newer link replaced this one while it loaded.
  if (result.stale) return;
  setFetching(false);

  // The link was edited while this one loaded; its result no longer applies.
  if (urlInput.value.trim() !== url) {
    if (result.jobId) window.api.discardJob(result.jobId);
    resetPreview();
    return;
  }

  if (result.needsPassword) {
    showPasswordPrompt(result, url);
    return;
  }
  hidePasswordPrompt();

  if (!result.success) {
    state.pendingRedownload = null;
    state.autoStart = false;
    resetPreview();
    renderError(previewError, result.error, { retry: () => urlForm.requestSubmit() });
    return;
  }

  state.jobId = result.jobId;
  state.info = result.info;
  state.formats = result.formats;
  state.fetchedUrl = url;
  renderPreview(result.info);
  state.convertOn = false;
  subsSelect.value = '';
  renderOptions();
  if (state.pendingRedownload) applyRedownload(state.pendingRedownload);
  if (state.autoStart) {
    state.autoStart = false;
    // Default quality and preset, no clip: exactly what the options already show.
    if (!downloadBtn.disabled) downloadBtn.click();
    return;
  }
  downloadBtn.focus();
}

/* ---------- password ---------- */

const passwordPrompt = $('password-prompt');
const passwordInput = $('password-input');
const passwordError = $('password-error');

function showPasswordPrompt(result, url) {
  // The same job is asking again after a wrong try; it must survive the reset.
  state.passwordJob = null;
  resetPreview();
  state.passwordJob = { id: result.jobId, url };
  preview.className = 'card preview';
  previewTitle.textContent = 'This video needs a password';
  previewSub.textContent = '';
  passwordInput.value = '';
  show(passwordError, !!result.wrongPassword);
  show(passwordPrompt, true);
  passwordInput.focus();
}

function hidePasswordPrompt() {
  state.passwordJob = null;
  show(passwordPrompt, false);
  passwordInput.value = '';
}

passwordPrompt.addEventListener('submit', async (event) => {
  event.preventDefault();
  const pending = state.passwordJob;
  const password = passwordInput.value;
  if (!pending || !password) return;
  passwordInput.value = '';
  $('unlock-btn').disabled = true;
  preview.className = 'card preview is-loading';
  previewTitle.textContent = 'Loading video details';
  previewSub.textContent = 'Loading';
  const result = window.api.submitPassword({ jobId: pending.id, password });
  await settleFetch(result, pending.url);
  $('unlock-btn').disabled = false;
});

$('password-cancel').addEventListener('click', () => {
  if (state.passwordJob) window.api.discardJob(state.passwordJob.id);
  hidePasswordPrompt();
  resetPreview();
});

// Dropping a link anywhere on the window (from a browser's address bar or a page) fetches it.
function droppedUrl(dataTransfer) {
  const text = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
  return text.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) || '';
}

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = state.downloading ? 'none' : 'copy';
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  const url = droppedUrl(event.dataTransfer);
  if (!url || state.downloading || fetchBtn.disabled) return;
  urlInput.value = url;
  urlForm.requestSubmit();
});

// Editing the link after fetching makes the preview stale.
urlInput.addEventListener('input', () => {
  if (state.passwordJob && urlInput.value.trim() !== state.passwordJob.url) {
    resetPreview();
  } else if (state.fetchedUrl && urlInput.value.trim() !== state.fetchedUrl && !state.downloading) {
    resetPreview();
    show(resultCard, false);
  }
});

/* ---------- options ---------- */

function availableModes() {
  const f = state.formats;
  if (!f) return { both: true, video: true, audio: true };
  return {
    both: f.hasVideo,
    video: f.hasVideoOnly,
    audio: f.hasAudio,
  };
}

function effectiveMode() {
  const modes = availableModes();
  if (modes[state.settings.mode]) return state.settings.mode;
  return ['both', 'audio', 'video'].find((m) => modes[m]) || 'both';
}

const CODEC_LABELS = { h264: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', other: '' };

// Always the best quality there is; nobody picks the 480p version of a 4K video.
function selectedQuality() {
  return { kind: 'best' };
}

// Subtitles: offered when the link has a track, for video only. A clip cuts the video but
// not the track, so they can't be combined.
function renderSubs() {
  const track = state.info && state.info.subtitles;
  const can = !!track && effectiveMode() !== 'audio' && !clipToggle.checked;
  show(subsField, can);
  if (!can) return;
  let name = track.lang;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'language' }).of(track.lang.replace(/-orig$/, '')) || name;
  } catch {
    // an unusual code: show it as it is
  }
  const language = `${name}${track.auto ? ', auto' : ''}`;
  subsSelect.options[1].textContent = `In the video · ${language}`;
  subsSelect.options[2].textContent = `Separate .srt file · ${language}`;
}

function renderOptions() {
  const ready = !!state.info && !state.downloading;
  optionsCard.classList.toggle('is-disabled', !ready);

  const modes = availableModes();
  const mode = effectiveMode();
  modeControl.querySelectorAll('button').forEach((btn) => {
    btn.disabled = !modes[btn.dataset.mode];
    btn.setAttribute('aria-checked', String(btn.dataset.mode === mode));
    btn.tabIndex = btn.dataset.mode === mode ? 0 : -1;
  });

  show(audioField, mode === 'audio');
  renderConvert();
  renderSubs();

  audioControl.querySelectorAll('button').forEach((btn) => {
    const selected = btn.dataset.format === state.settings.audioFormat;
    btn.setAttribute('aria-checked', String(selected));
    btn.tabIndex = selected ? 0 : -1;
  });
  audioHint.textContent = AUDIO_HINTS[state.settings.audioFormat] || '';

  renderPlan();
  clipEnd.placeholder = state.info && state.info.duration ? formatDuration(state.info.duration) : 'end';
  validateClip();
  updateDownloadButton();
}

const PRESET_SELECTABLE = ['original', 'h264'];

const CONVERT_LABELS = { h264: 'H.264 MP4' };
const CODEC_RANK = ['av1', 'vp9', 'hevc', 'h264', 'other'];

async function loadPresets() {
  const all = await window.api.getPresets();
  state.presets = all.filter((p) => PRESET_SELECTABLE.includes(p.id));
  renderOptions();
}

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// The stream the current choice will download, worked out from the formats the link offers.
// It's a prediction (yt-dlp makes the final pick), good enough to say what you're getting.
function predictedVideo() {
  const f = state.formats;
  if (!f || !f.options || !f.options.length) return null;
  const options = f.options;
  const best = (list) =>
    [...list].sort(
      (a, b) =>
        b.height - a.height ||
        (b.fps || 0) - (a.fps || 0) ||
        (b.hdr ? 1 : 0) - (a.hdr ? 1 : 0) ||
        CODEC_RANK.indexOf(a.vcodec) - CODEC_RANK.indexOf(b.vcodec)
    )[0];
  return best(options);
}

// Convert to H.264: off unless asked for, and only offered when the best video isn't H.264 already
// (re-encoding H.264 would only lose quality).
function canConvert() {
  if (effectiveMode() !== 'both' || !state.presets.some((p) => p.id === 'h264')) return false;
  const source = predictedVideo();
  return !!source && source.vcodec !== 'h264';
}

function renderConvert() {
  const can = canConvert();
  show(presetField, can);
  convertToggle.checked = can && state.convertOn;
  state.preset = can && state.convertOn ? 'h264' : 'original';
}

// One line saying what will land in the folder.
function renderPlan() {
  const mode = effectiveMode();
  const v = predictedVideo();
  if (!state.info || mode === 'audio') return show(planSummary, false);
  const codec = v ? [CODEC_LABELS[v.vcodec], v.hdr ? 'HDR' : ''].filter(Boolean).join(' ') : '';
  const source = v ? [v.height ? `${v.height}p` : '', codec].filter(Boolean).join(' ') : '';
  let text;
  if (state.preset !== 'original') {
    text = `${source ? `${source} → ` : ''}H.264 MP4`;
  } else {
    const size = v && v.estBytes ? ` · ~${formatBytes(v.estBytes)}` : '';
    text = ['MP4', codec, v && v.height ? `${v.height}p` : '', mode === 'both' ? 'AAC' : ''].filter(Boolean).join(' · ') + size;
  }
  planSummary.textContent = text;
  show(planSummary, true);
}

convertToggle.addEventListener('change', () => {
  state.convertOn = convertToggle.checked;
  renderOptions();
});

clipAccurate.addEventListener('change', () => {
  $('clip-cut-hint').textContent = clipAccurate.checked
    ? 'Frame-accurate. Slower, because the video is re-encoded around the cuts.'
    : 'Fast cut may start up to a few seconds early.';
});

// The cover is always embedded where the format allows it (not WAV).
function thumbEmbedAllowed() {
  return !(effectiveMode() === 'audio' && state.settings.audioFormat === 'wav');
}

function selectedClip() {
  if (!clipToggle.checked) return { clip: null, error: null };
  const fps = state.info && state.info.fps;
  const startResult = Timecode.parse(clipStart.value, fps);
  const endResult = Timecode.parse(clipEnd.value, fps);
  const duration = state.info && state.info.duration;
  clipStart.parentElement.classList.toggle('invalid', !!startResult.error);
  clipEnd.parentElement.classList.toggle('invalid', !!endResult.error);

  if (startResult.error || endResult.error) return { error: startResult.error || endResult.error };
  const start = startResult.value;
  const end = endResult.value;
  if (start == null && end == null) return { error: 'Enter a start time, an end time, or both.' };
  if (end != null && end <= (start || 0)) return { error: 'The end time has to be after the start.' };
  if (duration && start != null && start >= duration) return { error: `The video is only ${formatDuration(duration)} long.` };
  if (duration && end != null && end > duration + 1) return { error: `The video is only ${formatDuration(duration)} long.` };
  const clampedEnd = duration && end != null && end >= duration ? null : end;
  return { clip: { start: start || 0, end: clampedEnd }, error: null };
}

function validateClip() {
  show(clipFields, clipToggle.checked);
  show(clipMore, clipToggle.checked);
  const { clip, error } = selectedClip();
  const touched = clipStart.value.trim() || clipEnd.value.trim();
  clipError.textContent = error || '';
  show(clipError, !!error && !!touched);

  if (clip) {
    const end = clip.end == null ? state.info && state.info.duration : clip.end;
    clipLength.textContent = end ? `${formatDuration(end - clip.start)} of ${formatDuration(state.info.duration)}` : '';
  } else {
    clipLength.textContent = state.info && state.info.duration ? `Total ${formatDuration(state.info.duration)}` : '';
  }
  return { clip, error };
}

function updateDownloadButton() {
  const mode = effectiveMode();
  const clipError = clipToggle.checked ? selectedClip().error : null;
  downloadBtn.disabled = !state.info || state.downloading || !state.settings.lastFolder || !!clipError;
  const clip = clipToggle.checked ? ' clip' : '';
  const labels = {
    both: `Download video${clip}`,
    video: clip ? 'Download video-only clip' : 'Download video only',
    audio: `Download ${state.settings.audioFormat.toUpperCase()}${clip}`,
  };
  downloadBtn.textContent = labels[mode];
}

// Arrow keys move between segmented options, like native radio groups.
function wireSegmented(container, attr, onSelect) {
  container.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (btn && !btn.disabled) onSelect(btn.dataset[attr]);
  });
  container.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const buttons = [...container.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    const next = buttons[(index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    if (next) {
      onSelect(next.dataset[attr]);
      next.focus();
    }
    event.preventDefault();
  });
}

wireSegmented(modeControl, 'mode', (mode) => {
  saveSetting('mode', mode);
  renderOptions();
});

wireSegmented(audioControl, 'format', (format) => {
  saveSetting('audioFormat', format);
  renderOptions();
});

clipToggle.addEventListener('change', () => {
  renderSubs();
  validateClip();
  updateDownloadButton();
  if (clipToggle.checked) clipStart.focus();
});

[clipStart, clipEnd].forEach((input) =>
  input.addEventListener('input', () => {
    validateClip();
    updateDownloadButton();
  })
);

$('choose-folder-btn').addEventListener('click', async () => {
  const folder = await window.api.chooseFolder();
  if (folder) {
    state.settings.lastFolder = folder;
    folderPathEl.textContent = displayFolder(folder);
    folderPathEl.title = folder;
    updateDownloadButton();
  }
});

/* ---------- downloading ---------- */

function setDownloading(downloading) {
  state.downloading = downloading;
  state.cancelling = false;
  show(downloadBtn, !downloading);
  show(progressCard, downloading);
  urlInput.disabled = downloading;
  fetchBtn.disabled = downloading;
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Cancel';
  renderOptions();
}

function setProgress({ percent, indeterminate, stage, detail }) {
  progressTrack.classList.toggle('indeterminate', !!indeterminate);
  if (!indeterminate && typeof percent === 'number') {
    progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }
  progressPercent.textContent = indeterminate || typeof percent !== 'number' ? '' : `${Math.floor(percent)}%`;
  if (stage) progressStage.textContent = stage;
  progressDetail.textContent = detail || '';
}

downloadBtn.addEventListener('click', async () => {
  if (downloadBtn.disabled) return;
  const mode = effectiveMode();
  const { clip } = selectedClip();

  clearStatus();
  show(resultCard, false);
  setDownloading(true);
  setProgress({ indeterminate: true, stage: 'Starting…' });

  const result = await window.api.startDownload({
    jobId: state.jobId,
    folder: state.settings.lastFolder,
    mode,
    quality: selectedQuality(),
    preset: state.preset,
    thumbnail: { save: false, embed: thumbEmbedAllowed() },
    subtitles: subsField.classList.contains('hidden') ? '' : subsSelect.value,
    accurate: clipAccurate.checked,
    audioFormat: state.settings.audioFormat,
    clip,
    duration: state.info.duration,
  });

  if (!result.started) {
    setDownloading(false);
    if (result.error) renderError(statusEl, result.error, { retry: () => downloadBtn.click() });
  }
});

cancelBtn.addEventListener('click', () => {
  state.cancelling = true;
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Cancelling…';
  setProgress({ indeterminate: true, stage: 'Cancelling…' });
  window.api.cancelDownload();
});

function showProgress(p) {
  if (!p) return;
  if (p.stage === 'processing') {
    if (p.step === 'Convert' && typeof p.percent === 'number') {
      setProgress({ percent: p.percent, stage: 'Converting…', detail: '' });
      return;
    }
    setProgress({ indeterminate: true, stage: STEP_LABELS[p.step] || 'Finishing up…' });
    return;
  }
  const mode = effectiveMode();
  let stage = 'Downloading…';
  if (p.clip) stage = 'Downloading clip…';
  else if (p.streams > 1) stage = p.stream === 1 ? 'Downloading video (1 of 2)…' : 'Downloading audio (2 of 2)…';
  else if (mode === 'audio') stage = 'Downloading audio…';

  const detail = [p.size, p.speed, p.eta ? `${p.eta} left` : null].filter(Boolean).join(' · ');
  setProgress({ percent: p.percent, stage, detail });
}

// The main process moves the job through its stages; the window just follows along.
window.api.onJobUpdate((job) => {
  if (job.status === 'resolving' && job.resolver === 'sniff' && fetchBtn.disabled) previewSub.textContent = 'Using stream capture…';
  if (job.id !== state.jobId) return;
  if (job.status === 'downloading' || job.status === 'processing') {
    if (state.cancelling) return;
    if (!state.downloading) setDownloading(true);
    showProgress(job.progress);
  } else if (job.status === 'done') {
    setDownloading(false);
    state.lastFile = job.outputPath;
    $('result-title').textContent = job.existing ? 'Already in this folder' : 'Saved';
    resultFile.textContent = job.outputPath ? job.outputPath.split(/[\\/]/).pop() : 'Download finished';
    resultFile.title = job.outputPath || '';
    $('reveal-btn').disabled = !job.outputPath;
    $('open-btn').disabled = !job.outputPath;
    show(resultCard, true);
  } else if (job.status === 'failed') {
    if (state.downloading) setDownloading(false);
    // A failure while loading the link is shown by the fetch itself.
    if (state.info) renderError(statusEl, job.error, { retry: () => downloadBtn.click() });
  } else if (job.status === 'ready' && job.cancelled) {
    setDownloading(false);
    setStatus('Download cancelled. Partial files were removed.', 'info');
  }
});

$('reveal-btn').addEventListener('click', () => window.api.showInFolder(state.lastFile));
$('open-btn').addEventListener('click', () => window.api.openFile(state.lastFile));

initMain();
