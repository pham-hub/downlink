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
const codecField = $('codec-field');
const codecControl = $('codec-control');
const codecHint = $('codec-hint');
const audioField = $('audio-field');
const audioControl = $('audio-control');
const audioHint = $('audio-hint');
const clipToggle = $('clip-toggle');
const clipFields = $('clip-fields');
const clipStart = $('clip-start');
const clipEnd = $('clip-end');
const clipLength = $('clip-length');
const clipError = $('clip-error');
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
  wav: 'Uncompressed and large. Best for editing. Title and artist tags only.',
};

const CODEC_HINTS = {
  best: 'AV1 or VP9 when available. Sharpest picture at the same size; needs a recent Mac or player.',
  compatible: 'H.264. Plays everywhere, including older devices, but looks softer at low bitrates.',
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
  settings: { mode: 'both', quality: 'best', audioFormat: 'mp3', videoCodec: 'best', lastFolder: null },
  info: null,
  formats: null,
  fetchedUrl: null,
  downloading: false,
  cancelling: false,
  lastFile: null,
};

/* ---------- helpers ---------- */

function show(el, visible) {
  el.classList.toggle('hidden', !visible);
}

function formatDuration(seconds) {
  if (seconds == null) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// Accepts "90", "1:30", "1:02:03" (and decimals on the seconds). Empty -> null, invalid -> NaN.
function parseTime(text) {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return NaN;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

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
  show(statusEl, false);
}

function saveSetting(key, value) {
  state.settings[key] = value;
  window.api.saveSettings({ [key]: value });
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
    previewError.textContent = result.error;
    show(previewError, true);
    return;
  }

  state.info = result.info;
  state.formats = result.formats;
  state.fetchedUrl = url;
  renderPreview(result.info);
  renderOptions();
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
  if (!url || state.downloading) return;
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

function renderQualityOptions() {
  const qualities = state.formats ? state.formats.qualities : [];
  qualitySelect.innerHTML = '';
  const best = document.createElement('option');
  best.value = 'best';
  best.textContent = qualities.length ? `Best available (${qualities[0].label})` : 'Best available';
  qualitySelect.appendChild(best);
  qualities.forEach(({ height, label }) => {
    const option = document.createElement('option');
    option.value = String(height);
    option.textContent = label;
    qualitySelect.appendChild(option);
  });

  // Remembered quality: pick the highest available at or below it.
  const preferred = state.settings.quality;
  if (preferred !== 'best') {
    const match = qualities.find((q) => q.height <= Number(preferred));
    qualitySelect.value = match ? String(match.height) : 'best';
  } else {
    qualitySelect.value = 'best';
  }
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
  show(codecField, mode !== 'audio');
  show(audioField, mode === 'audio');
  renderQualityOptions();

  audioControl.querySelectorAll('button').forEach((btn) => {
    const selected = btn.dataset.format === state.settings.audioFormat;
    btn.setAttribute('aria-checked', String(selected));
    btn.tabIndex = selected ? 0 : -1;
  });
  audioHint.textContent = AUDIO_HINTS[state.settings.audioFormat] || '';

  codecControl.querySelectorAll('button').forEach((btn) => {
    const selected = btn.dataset.codec === state.settings.videoCodec;
    btn.setAttribute('aria-checked', String(selected));
    btn.tabIndex = selected ? 0 : -1;
  });
  codecHint.textContent = CODEC_HINTS[state.settings.videoCodec] || '';

  clipEnd.placeholder = state.info && state.info.duration ? formatDuration(state.info.duration) : 'end';
  validateClip();
  updateDownloadButton();
}

function selectedClip() {
  if (!clipToggle.checked) return { clip: null, error: null };
  const start = parseTime(clipStart.value);
  const end = parseTime(clipEnd.value);
  const duration = state.info && state.info.duration;
  clipStart.parentElement.classList.toggle('invalid', Number.isNaN(start));
  clipEnd.parentElement.classList.toggle('invalid', Number.isNaN(end));

  if (Number.isNaN(start) || Number.isNaN(end)) return { error: 'Use times like 1:20 or 1:02:30.' };
  if (start == null && end == null) return { error: 'Enter a start time, an end time, or both.' };
  if (end != null && end <= (start || 0)) return { error: 'The end time has to be after the start.' };
  if (duration && start != null && start >= duration) return { error: `The video is only ${formatDuration(duration)} long.` };
  const clampedEnd = duration && end != null && end >= duration ? null : end;
  return { clip: { start: start || 0, end: clampedEnd }, error: null };
}

function validateClip() {
  show(clipFields, clipToggle.checked);
  const { clip, error } = selectedClip();
  const touched = clipStart.value.trim() || clipEnd.value.trim();
  clipError.textContent = error || '';
  show(clipError, !!error && !!touched);

  if (clip) {
    const end = clip.end == null ? state.info && state.info.duration : clip.end;
    clipLength.textContent = end ? `${formatDuration(end - clip.start)} long` : '';
  } else {
    clipLength.textContent = '';
  }
  return { clip, error };
}

function updateDownloadButton() {
  const mode = effectiveMode();
  const { error } = clipToggle.checked ? selectedClip() : { error: null };
  downloadBtn.disabled = !state.info || state.downloading || !state.settings.lastFolder || !!error;
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

wireSegmented(codecControl, 'codec', (codec) => {
  saveSetting('videoCodec', codec);
  renderOptions();
});

qualitySelect.addEventListener('change', () => {
  saveSetting('quality', qualitySelect.value);
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
    url: state.fetchedUrl,
    folder: state.settings.lastFolder,
    mode,
    height: mode === 'audio' || qualitySelect.value === 'best' ? null : Number(qualitySelect.value),
    // "720p" from "720p" or "2160p · 4K", for the file name.
    qualityLabel: qualitySelect.selectedOptions[0]?.textContent.split(' ')[0] || null,
    audioFormat: state.settings.audioFormat,
    videoCodec: state.settings.videoCodec,
    clip,
    duration: state.info.duration,
  });

  if (!result.started) {
    setDownloading(false);
    setStatus(result.error || 'Could not start the download.');
  }
});

cancelBtn.addEventListener('click', () => {
  state.cancelling = true;
  cancelBtn.disabled = true;
  cancelBtn.textContent = 'Cancelling…';
  setProgress({ indeterminate: true, stage: 'Cancelling…' });
  window.api.cancelDownload();
});

window.api.onDownloadProgress((p) => {
  if (state.cancelling) return;
  if (p.stage === 'processing') {
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
});

window.api.onDownloadComplete(({ filePath }) => {
  setDownloading(false);
  state.lastFile = filePath;
  resultFile.textContent = filePath ? filePath.split('/').pop() : 'Download finished';
  resultFile.title = filePath || '';
  $('reveal-btn').disabled = !filePath;
  $('open-btn').disabled = !filePath;
  show(resultCard, true);
});

window.api.onDownloadError(({ message }) => {
  setDownloading(false);
  setStatus(message);
});

window.api.onDownloadCancelled(() => {
  setDownloading(false);
  setStatus('Download cancelled. Partial files were removed.', 'info');
});

$('reveal-btn').addEventListener('click', () => window.api.showInFolder(state.lastFile));
$('open-btn').addEventListener('click', () => window.api.openFile(state.lastFile));

initMain();
