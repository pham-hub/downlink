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
const qualityField = $('quality-field');
const qualitySelect = $('quality-select');
const qualityHint = $('quality-hint');
const advancedWrap = $('advanced-wrap');
const advancedToggle = $('advanced-toggle');
const advancedBody = $('advanced-body');
const formatSelect = $('format-select');
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
const presetSelect = $('preset-select');
const presetHint = $('preset-hint');
const presetError = $('preset-error');
const stillFields = $('still-fields');
const stillTime = $('still-time');
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
  settings: { mode: 'both', defaultQuality: 'best-compatible', audioFormat: 'mp3', lastFolder: null },
  info: null,
  preset: 'original',
  presets: [{ id: 'original', label: 'Original' }],
  estimate: null,
  formats: null,
  fetchedUrl: null,
  jobId: null,
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
  if (id === 'show-folder') {
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

function openSettings() {
  const set = $('set-preset');
  set.innerHTML = '';
  state.presets.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.label;
    set.appendChild(option);
  });
  set.value = state.settings.defaultPreset || 'original';
  $('set-keep').checked = !!state.settings.keepOriginal;
  show(mainScreen, false);
  show(settingsScreen, true);
}

function closeSettings() {
  show(settingsScreen, false);
  show(mainScreen, true);
}

$('settings-btn').addEventListener('click', () => (settingsScreen.classList.contains('hidden') ? openSettings() : closeSettings()));
$('settings-done').addEventListener('click', closeSettings);
$('set-preset').addEventListener('change', (e) => saveSetting('defaultPreset', e.target.value));
$('set-keep').addEventListener('change', (e) => saveSetting('keepOriginal', e.target.checked));

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
  state.preset = state.settings.defaultPreset || 'original';
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
  fetchBtn.disabled = true;
  show(fetchBtn.querySelector('.spinner'), true);
  show(fetchBtn.querySelector('.label'), false);

  const result = await window.api.fetchInfo(url);
  // A newer link replaced this one while it loaded.
  if (result.stale) return;

  fetchBtn.disabled = false;
  show(fetchBtn.querySelector('.spinner'), false);
  show(fetchBtn.querySelector('.label'), true);

  // The link was edited while this one loaded; its result no longer applies.
  if (urlInput.value.trim() !== url) {
    resetPreview();
    return;
  }

  if (!result.success) {
    resetPreview();
    renderError(previewError, result.error, { retry: () => urlForm.requestSubmit() });
    return;
  }

  state.jobId = result.jobId;
  state.info = result.info;
  state.formats = result.formats;
  state.fetchedUrl = url;
  renderPreview(result.info);
  state.preset = state.presets.some((p) => p.id === state.settings.defaultPreset) ? state.settings.defaultPreset : 'original';
  presetSelect.value = state.preset;
  renderOptions();
  refreshEstimate();
  downloadBtn.focus();
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
  if (state.fetchedUrl && urlInput.value.trim() !== state.fetchedUrl && !state.downloading) {
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

const PREFERRED_TIERS = [4320, 2880, 2160, 1440, 1080, 720, 480];
const CODEC_LABELS = { h264: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1', other: '' };

// Best compatible (H.264) and Best quality (any codec) come first, then one entry per height.
// The Advanced list has every individual format for the rare case that needs one.
function renderQualityOptions() {
  const f = state.formats;
  const qualities = f ? f.qualities.filter((q) => PREFERRED_TIERS.includes(q.tier) || f.qualities.length < 3) : [];
  qualitySelect.innerHTML = '';
  const add = (value, text) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    qualitySelect.appendChild(option);
  };
  add('best-compatible', 'Best compatible (H.264)');
  add('best-quality', 'Best quality (any codec)');
  qualities.forEach((q) => add(`tier-${q.tier}`, q.h264 ? q.label : `${q.label} · no H.264`));

  // Remembered choice: the same height if it's offered, else the nearest one below.
  const saved = state.settings.defaultQuality || 'best-compatible';
  let choice = 'best-compatible';
  if (saved === 'best-quality') choice = saved;
  else if (saved.startsWith('tier-')) {
    const match = qualities.find((q) => q.tier <= Number(saved.slice(5)));
    if (match) choice = `tier-${match.tier}`;
  }
  qualitySelect.value = choice;

  formatSelect.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Use the quality above';
  formatSelect.appendChild(auto);
  ((f && f.options) || []).forEach((o) => {
    const option = document.createElement('option');
    option.value = o.id;
    option.textContent = `${o.label}${o.hasAudio ? ' · with audio' : ''}`;
    formatSelect.appendChild(option);
  });
  show(advancedWrap, !!(f && f.options && f.options.length));
  renderQualityHint();
}

function selectedQuality() {
  const formatId = formatSelect.value;
  if (formatId) return { kind: 'format', formatId };
  const value = qualitySelect.value;
  if (value.startsWith('tier-')) {
    const tier = Number(value.slice(5));
    const q = state.formats && state.formats.qualities.find((x) => x.tier === tier);
    return { kind: 'tier', resolution: q ? q.res : null, label: q ? q.label.split(' ')[0] : null };
  }
  return { kind: value === 'best-quality' ? 'best' : 'compatible' };
}

// AV1, VP9 and HDR streams are the ones some editors and media servers can't open.
function renderQualityHint() {
  const f = state.formats;
  const q = selectedQuality();
  let risky = false;
  if (q.kind === 'format') {
    const o = f.options.find((x) => x.id === q.formatId);
    risky = !!o && (o.vcodec === 'av1' || o.vcodec === 'vp9' || o.hdr);
  } else if (q.kind === 'best') {
    risky = !!(f && f.bestNeedsBadge);
  } else if (q.kind === 'tier') {
    const tier = qualitySelect.value.slice(5);
    const entry = f && f.qualities.find((x) => String(x.tier) === tier);
    risky = !!entry && !entry.h264;
  }
  show(qualityHint, risky);
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

  show(qualityField, mode !== 'audio');
  show(presetField, mode === 'both');
  show(clipField, !(mode === 'both' && state.preset === 'still'));
  show(stillFields, mode === 'both' && state.preset === 'still');
  show(audioField, mode === 'audio');
  renderQualityOptions();

  audioControl.querySelectorAll('button').forEach((btn) => {
    const selected = btn.dataset.format === state.settings.audioFormat;
    btn.setAttribute('aria-checked', String(selected));
    btn.tabIndex = selected ? 0 : -1;
  });
  audioHint.textContent = AUDIO_HINTS[state.settings.audioFormat] || '';

  renderPresetHint();
  clipEnd.placeholder = state.info && state.info.duration ? formatDuration(state.info.duration) : 'end';
  validateClip();
  updateDownloadButton();
}

const PRESET_SELECTABLE = ['original', 'h264', 'prores422', 'prores422hq', 'still'];

async function loadPresets() {
  const all = await window.api.getPresets();
  state.presets = all.filter((p) => PRESET_SELECTABLE.includes(p.id));
  presetSelect.innerHTML = '';
  state.presets.forEach((p) => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.label;
    presetSelect.appendChild(option);
  });
  if (!state.presets.some((p) => p.id === state.preset)) state.preset = 'original';
  presetSelect.value = state.preset;
  renderOptions();
}

function formatBytes(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// ProRes files are big: say how big before starting, and stop if the disk can't hold it.
async function refreshEstimate() {
  state.estimate = null;
  const large = state.presets.find((p) => p.id === state.preset && p.large);
  if (!large || !state.jobId) return renderPresetHint();
  const { clip } = selectedClip();
  const q = selectedQuality();
  const clipSeconds = clip ? (clip.end == null ? state.info.duration : clip.end) - clip.start : null;
  state.estimate = await window.api.estimateOutput({
    jobId: state.jobId, preset: state.preset, height: q.kind === 'tier' ? q.resolution : null, clipSeconds,
  });
  renderPresetHint();
  updateDownloadButton();
}

function renderPresetHint() {
  const e = state.estimate;
  const large = state.presets.find((p) => p.id === state.preset && p.large);
  show(presetHint, !!(large && e && e.bytes));
  show(presetError, false);
  if (large && e && e.bytes) {
    presetHint.textContent = `≈ ${formatBytes(e.bytes)}${e.bytes >= 1e9 ? ' (large file)' : ''}`;
    if (e.freeBytes != null && e.freeBytes < e.bytes * 1.2) {
      presetError.textContent = 'Your disk is full.';
      show(presetError, true);
    }
  }
}

presetSelect.addEventListener('change', () => {
  state.preset = presetSelect.value;
  renderOptions();
  refreshEstimate();
});

stillTime.addEventListener('input', updateDownloadButton);
clipAccurate.addEventListener('change', () => {
  $('clip-cut-hint').textContent = clipAccurate.checked
    ? 'Frame-accurate. Slower, because the video is re-encoded around the cuts.'
    : 'Fast cut may start up to a few seconds early.';
});

function selectedClip() {
  if (!clipToggle.checked || state.preset === 'still') return { clip: null, error: null };
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

function selectedStill() {
  const result = Timecode.parse(stillTime.value, state.info && state.info.fps);
  const duration = state.info && state.info.duration;
  stillTime.parentElement.classList.toggle('invalid', !!result.error);
  if (result.error) return { error: result.error };
  const value = result.value == null ? 0 : result.value;
  if (duration && value >= duration) return { error: `The video is only ${formatDuration(duration)} long.` };
  return { sec: value, error: null };
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
  const still = mode === 'both' && state.preset === 'still';
  const clipError = clipToggle.checked && !still ? selectedClip().error : null;
  const stillError = still ? selectedStill().error : null;
  const noRoom = !!(state.estimate && state.estimate.freeBytes != null && state.estimate.bytes && state.estimate.freeBytes < state.estimate.bytes * 1.2);
  downloadBtn.disabled =
    !state.info || state.downloading || !state.settings.lastFolder || !!clipError || !!stillError || noRoom;
  const clip = clipToggle.checked && !still ? ' clip' : '';
  const presetName = state.presets.find((p) => p.id === state.preset);
  const labels = {
    both: still ? 'Save still frame' : `Download video${clip}`,
    video: clip ? 'Download video-only clip' : 'Download video only',
    audio: `Download ${state.settings.audioFormat.toUpperCase()}${clip}`,
  };
  downloadBtn.textContent = labels[mode];
  if (mode === 'both' && presetName && state.preset !== 'original' && !still) {
    downloadBtn.textContent = `${labels[mode]} · ${presetName.label.replace(/ \(.*\)$/, '')}`;
  }
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

qualitySelect.addEventListener('change', () => {
  formatSelect.value = '';
  saveSetting('defaultQuality', qualitySelect.value);
  renderQualityHint();
});

formatSelect.addEventListener('change', () => {
  renderQualityHint();
  refreshEstimate();
});

advancedToggle.addEventListener('click', () => {
  const open = advancedBody.classList.contains('hidden');
  show(advancedBody, open);
  advancedToggle.setAttribute('aria-expanded', String(open));
  if (!open) {
    formatSelect.value = '';
    renderQualityHint();
  }
});

clipToggle.addEventListener('change', () => {
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
    accurate: clipAccurate.checked,
    stillSec: state.preset === 'still' ? selectedStill().sec : undefined,
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
      const what = state.preset === 'still' ? 'Saving still frame…' : 'Converting…';
      setProgress({ percent: p.percent, stage: what, detail: '' });
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
