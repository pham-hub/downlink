const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const binaries = require('./binaries');
const settings = require('./settings');
const { fetchInfo } = require('./downloader');
const { startJob } = require('./pipeline');
const presets = require('./presets');
const thumbs = require('./thumbs');
const history = require('./history');
const { createWatcher } = require('./clipboard-watch');
const { summarizeFormats, summarizeVariants } = require('./formats');
const { sniff } = require('./sniff');
const { startSniffSource, safeName } = require('./sniff/source');
const { JobStore } = require('./jobs');
const { friendlyError, errorFromCode } = require('./errors/map');

const WINDOW_WIDTH = 600;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

const jobs = new JobStore();

// Offers links copied to the clipboard. A busy job isn't interrupted, and the same link is only
// offered once in half an hour.
const clipboardWatch = createWatcher({
  getMode: () => settings.getSettings().clipboardWatch,
  isQueued: (link) => jobs.isBusy() || (!!jobs.current && jobs.current.sourceUrl === link),
  onOffer: (link) => send('clipboard-offer', { url: link, host: new URL(link).hostname.replace(/^www\./, '') }),
});

let mainWindow;
let activeDownload = null;
let quitWhenCancelled = false;
// Files this app saved; Open / Show in Finder only ever act on these.
const savedFiles = new Set();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: 600,
    useContentSize: true,
    resizable: false,
    show: false,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : {
          // Windows: hide the native bar but keep the system minimize/close buttons, dark to match.
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#00000000', symbolColor: '#9fb3c4', height: 50 },
        }),
    backgroundColor: '#04080c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('focus', () => {
    mainWindow.flashFrame(false);
    clipboardWatch.onFocus();
  });
  clipboardWatch.apply();

  // The window only ever shows the app's own page. Without this, dropping a link onto it would
  // load that website in place of the app (the page handles dropped links itself instead).
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Closing the window (or quitting) mid-download asks first, then cancels cleanly so no
  // partial files are left behind.
  mainWindow.on('close', (event) => {
    if (!activeDownload) return;
    event.preventDefault();
    if (quitWhenCancelled) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Keep Downloading', 'Stop and Quit'],
      defaultId: 0,
      cancelId: 0,
      message: 'A download is still running.',
      detail: 'Quitting stops it and removes the partial file.',
    });
    if (choice === 1) {
      quitWhenCancelled = true;
      activeDownload.cancel();
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Electron's default menu has Reload, Developer Tools, zoom and links to electronjs.org. Reloading
// mid-download would lose track of it, and zoom breaks the fixed-width layout. Edit stays for
// copy and paste.
function setMenu() {
  if (process.platform !== 'darwin') {
    // No visible menu bar on Windows; the Edit menu still wires up Ctrl+C / Ctrl+V.
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }]));
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  );
}

app.whenReady().then(() => {
  setMenu();
  // Needed for toast notifications to show the app's name on Windows.
  if (process.platform === 'win32') app.setAppUserModelId('com.andrewpham.downlink');
  // The packaged app gets its icon from build/icon.icns; this covers `npm start`.
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  if (app.dock && !app.isPackaged && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  binaries.removeStaleCopies();
  jobs.sweepTemp();
  loadEncoders();
  createWindow();
  setTimeout(updateTools, 5000);
  setInterval(updateTools, UPDATE_CHECK_INTERVAL);
});

// A single-window utility: closing the window quits, so a download is never left running unseen.
app.on('window-all-closed', () => {
  clipboardWatch.stop();
  app.quit();
});

// ffmpeg's encoder list is read once at startup; presets this machine can't make are hidden.
let encoders = { h264: null, prores: null };
async function loadEncoders() {
  try {
    encoders = presets.chooseEncoders(await presets.detectEncoders(binaries.getPaths().ffmpegPath));
  } catch {
    // tools missing; the first download reports it
  }
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// The window grows and shrinks with its content instead of scrolling.
ipcMain.on('resize-to-content', (event, height) => {
  if (!mainWindow || !Number.isFinite(height)) return;
  const maxHeight = screen.getDisplayMatching(mainWindow.getBounds()).workAreaSize.height - 40;
  mainWindow.setContentSize(WINDOW_WIDTH, Math.min(Math.ceil(height), maxHeight), true);
});

// Quietly keeps yt-dlp and Deno current; the footer picks up the new versions.
async function updateTools() {
  const changed = await binaries.updateInBackground();
  if (changed.length) send('tools-updated', binaries.getVersions());
}

ipcMain.handle('get-tool-versions', () => binaries.getVersions());

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url.trim());
}

ipcMain.handle('get-presets', async () => {
  await loadEncodersOnce();
  return presets.availablePresets(encoders).map((id) => ({ id, label: presets.PRESETS[id].label, large: !!presets.PRESETS[id].large }));
});

let encodersReady = null;
function loadEncodersOnce() {
  if (!encodersReady) encodersReady = loadEncoders();
  return encodersReady;
}

// How big a ProRes file will get, and whether there's room for it.
ipcMain.handle('estimate-output', (event, { jobId, preset, height, clipSeconds }) => {
  const job = jobs.get(jobId);
  if (!job) return null;
  const top = (job.formats || [])[0] || {};
  const h = Number.isInteger(height) ? height : top.height;
  const w = Number.isInteger(height) ? Math.round((height * 16) / 9) : top.width || Math.round(((top.height || 1080) * 16) / 9);
  const bytes = presets.estimateBytes(preset, {
    width: w, height: h || 1080, fps: job.fps || 30, durationSec: clipSeconds || job.durationSec,
  });
  return { bytes, freeBytes: freeSpace(settings.getSettings().lastFolder) };
});

function freeSpace(folder) {
  try {
    const stat = fs.statfsSync(folder);
    return stat.bavail * stat.bsize;
  } catch {
    return null;
  }
}

function validClip(clip) {
  if (!clip) return null;
  const start = Number(clip.start) || 0;
  const end = clip.end == null ? null : Number(clip.end);
  if (start < 0 || (end != null && !(end > start))) return null;
  return { start, end };
}

// The window follows a job through snapshots; it never sees passwords or process handles.
jobs.on('update', (snapshot) => send('job-update', snapshot));

function bestFps(formats) {
  const top = formats.options[0];
  return top && top.fps ? top.fps : undefined;
}

// The quality choice from the window, checked against what the link really offers.
function resolveQuality(job, quality) {
  const q = quality || {};
  if (q.kind === 'format') {
    const option = (job.formats || []).find((f) => f.id === q.formatId);
    if (option) {
      return {
        formatId: option.id,
        formatHasAudio: !!option.hasAudio,
        formatTag: `${option.height}p, ${option.vcodec === 'other' ? 'format ' + option.id : option.vcodec.toUpperCase().replace('H264', 'H.264')}`,
        videoCodec: 'best',
        resolution: null,
      };
    }
  }
  const resolution = q.kind === 'tier' && Number.isInteger(q.resolution) ? q.resolution : null;
  return { videoCodec: q.kind === 'best' ? 'best' : 'compatible', resolution, qualityLabel: q.label };
}

function errorContext(job, source = 'ytdlp') {
  return { resolver: job.resolver, source, sniffEnabled: settings.getSettings().sniffFallback };
}

// Turns whatever a tool run threw into a FriendlyError.
function toFriendly(job, err, source) {
  if (err && err.code && !err.raw) return errorFromCode(err.code, err.message);
  if (err && err.code) return errorFromCode(err.code, err.raw);
  return friendlyError((err && (err.raw || err.message)) || '', errorContext(job, source));
}

ipcMain.handle('fetch-info', async (event, url) => {
  if (!isWebUrl(url)) return { success: false, error: errorFromCode('INVALID_URL') };

  let job;
  try {
    job = jobs.create(url.trim(), settings.getSettings());
  } catch (err) {
    return { success: false, error: errorFromCode('UNKNOWN', err.message) };
  }
  jobs.transition(job, 'resolving');
  return resolveJob(job);
});

const MAX_PASSWORD_TRIES = 3;

// Reads the link with yt-dlp (`-J`). A password-protected video waits for the user in
// `awaiting_input`; a page yt-dlp can't read goes on to stream capture.
async function resolveJob(job) {
  try {
    const task = fetchInfo(binaries.getPaths(), job.sourceUrl, { password: job.password });
    job.task = task;
    const info = await task;
    // The user moved on to another link while this one loaded.
    if (jobs.get(job.id) !== job) return { success: false, stale: true };
    const formats = summarizeFormats(info);
    jobs.transition(job, 'ready', {
      title: info.title,
      durationSec: info.duration || undefined,
      fps: bestFps(formats),
      formats: formats.options,
      thumbnailUrl: info.thumbnail || undefined,
      wrongPassword: false,
      task: undefined,
    });
    return {
      success: true,
      jobId: job.id,
      info: {
        title: info.title,
        uploader: info.uploader || info.channel || info.creator || null,
        duration: info.duration || null,
        fps: bestFps(formats),
        thumbnail: info.thumbnail || null,
        site: info.extractor_key || null,
      },
      formats,
    };
  } catch (err) {
    if (jobs.get(job.id) !== job) return { success: false, stale: true };
    const error = toFriendly(job, err);
    if (error.code === 'PASSWORD' || error.code === 'WRONG_PASSWORD') return askForPassword(job, error);
    // yt-dlp can't read the page: let the site's own player show us the stream instead.
    if (/Unsupported URL|No video formats found/i.test((err && err.raw) || '') && settings.getSettings().sniffFallback) {
      return captureStream(job);
    }
    jobs.fail(job, error);
    return { success: false, jobId: job.id, error };
  }
}

// The card shows a password field. Three wrong tries and the job fails.
function askForPassword(job, error) {
  const wrong = error.code === 'WRONG_PASSWORD';
  job.password = undefined;
  if (wrong) job.passwordTries = (job.passwordTries || 0) + 1;
  if (wrong && job.passwordTries >= MAX_PASSWORD_TRIES) {
    const failure = errorFromCode('WRONG_PASSWORD', error.details);
    jobs.fail(job, failure);
    return { success: false, jobId: job.id, error: failure };
  }
  jobs.transition(job, 'awaiting_input', { needs: 'password', wrongPassword: wrong, task: undefined });
  return { success: false, needsPassword: true, wrongPassword: wrong, jobId: job.id, tries: job.passwordTries || 0 };
}

// Unlock: tries the same link again with the password the user typed.
ipcMain.handle('submit-password', async (event, { jobId, password }) => {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'awaiting_input' || typeof password !== 'string' || !password) {
    return { success: false, stale: true };
  }
  job.password = password;
  jobs.transition(job, 'resolving', { needs: undefined });
  return resolveJob(job);
});

// Stream capture fallback (spec section 1): a hidden window loads the page and notes the stream.
async function captureStream(job) {
  jobs.update(job, { resolver: 'sniff' });
  try {
    const task = sniff(job.sourceUrl, { jobId: job.id });
    job.task = task;
    const result = await task;
    if (jobs.get(job.id) !== job) return { success: false, stale: true };
    const host = new URL(job.sourceUrl).hostname.replace(/^www\./, '');
    const summary = result.variants
      ? summarizeVariants(result.variants, result.durationSec)
      : { qualities: [], options: [], bestNeedsBadge: false, hasVideo: true, hasVideoOnly: false, hasAudio: true };
    const title = (result.pageTitle || '').trim() || host;
    jobs.transition(job, 'ready', {
      title,
      durationSec: result.durationSec,
      fps: bestFps(summary),
      formats: summary.options,
      sniff: result,
      thumbnailUrl: result.posterUrl,
      thumbnailHeaders: result.headers,
      task: undefined,
    });
    return {
      success: true,
      jobId: job.id,
      info: { title, uploader: null, duration: result.durationSec || null, fps: bestFps(summary), thumbnail: result.posterUrl || null, site: host },
      formats: summary,
    };
  } catch (err) {
    if (jobs.get(job.id) !== job || (err && err.code === 'CANCELLED')) return { success: false, stale: true };
    const error = toFriendly(job, err);
    jobs.fail(job, error);
    return { success: false, jobId: job.id, error };
  }
}

// Which captured rendition the picker's choice means.
function pickVariant(variants, quality) {
  if (!variants || !variants.length) return null;
  const sorted = [...variants].sort((a, b) => b.height - a.height);
  const q = quality || {};
  if (q.kind === 'format') return sorted.find((v) => v.id === q.formatId) || sorted[0];
  if (q.kind === 'tier' && Number.isInteger(q.resolution)) {
    return sorted.find((v) => v.height <= q.resolution) || sorted[sorted.length - 1];
  }
  return sorted[0];
}

function headerArgs(h) {
  const args = [];
  if (h.referer) args.push('--add-header', `Referer:${h.referer}`);
  if (h.origin) args.push('--add-header', `Origin:${h.origin}`);
  if (h.userAgent) args.push('--user-agent', h.userAgent);
  if (h.cookie) args.push('--add-header', `Cookie:${h.cookie}`);
  return args;
}

// What differs for a captured stream: where the file comes from and how it's named.
function sniffOptions(job, request, payload, paths) {
  const sn = job.sniff;
  const variant = pickVariant(sn.variants, payload.quality);
  const q = payload.quality || {};
  const tag = variant && q.kind === 'tier' ? `${variant.height}p` : variant && q.kind === 'format' ? `${variant.height}p, H.264` : '';
  if (sn.audio) {
    // Separate video and audio playlists: ffmpeg downloads and joins them.
    return {
      sourceStarter: (opts, hooks) =>
        startSniffSource(
          {
            sniff: sn,
            videoUrl: variant ? variant.url : sn.video.url,
            folder: opts.folder,
            title: job.title,
            tag,
            clip: request.clip,
            accurate: request.accurate,
            durationSec: job.durationSec,
            ffmpegPath: paths.ffmpegPath,
            encoders,
          },
          hooks
        ),
    };
  }
  // One URL (master playlist, manifest or file): yt-dlp downloads it with the page's headers.
  const top = variant && sn.variants ? [...sn.variants].sort((a, b) => b.height - a.height)[0] : null;
  return {
    url: sn.video.url,
    extraArgs: headerArgs(sn.headers || {}),
    fixedTitle: safeName(job.title),
    formatId: undefined,
    videoCodec: 'best',
    resolution: variant && top && variant.height < top.height ? variant.height : null,
    qualityLabel: variant && top && variant.height < top.height ? `${variant.height}p` : undefined,
  };
}

// The link was edited or cleared: whatever was loaded for it no longer applies.
ipcMain.handle('discard-job', (event, id) => {
  const job = jobs.get(id);
  if (job && !jobs.isBusy()) jobs.discard();
});

ipcMain.handle('get-settings', () => settings.getSettings());
ipcMain.handle('save-settings', (event, partial) => {
  settings.saveSettings(partial);
  clipboardWatch.apply();
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath: settings.getSettings().lastFolder,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const folder = result.filePaths[0];
  settings.saveSettings({ lastFolder: folder });
  return folder;
});

// Windows touches: progress shown on the taskbar button, and the button flashes when a
// download finishes while the window is in the background.
function setTaskbarProgress(progress) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (progress.stage === 'processing') mainWindow.setProgressBar(2, { mode: 'indeterminate' });
  else if (Number.isFinite(progress.percent)) mainWindow.setProgressBar(Math.min(progress.percent, 100) / 100);
}

function clearTaskbar(flash) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setProgressBar(-1);
  if (flash && !mainWindow.isFocused()) mainWindow.flashFrame(true);
}

function notifyComplete(filePath) {
  if (!Notification.isSupported() || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFocused()) return;
  const notification = new Notification({
    title: 'Download complete',
    body: filePath ? path.basename(filePath) : 'Your download has finished.',
  });
  notification.on('click', () => {
    if (filePath) shell.showItemInFolder(filePath);
    mainWindow.show();
  });
  notification.show();
}

// Picks the preset and clip for a job from what the window sent, ignoring anything invalid.
// The v1.0 audio-only mode maps onto the spec's audio presets: WAV and "original".
function resolveOutput(job, payload) {
  const available = new Set(presets.availablePresets(encoders));
  let preset = presets.isPresetId(payload.preset) && available.has(payload.preset) ? payload.preset : 'original';
  let audioFormat = payload.audioFormat;
  if (payload.mode === 'audio') preset = audioFormat === 'wav' ? 'wav' : audioFormat === 'original' ? 'audio-original' : 'original';
  else if (payload.mode === 'video') preset = 'original';
  const clip = validClip(payload.clip);
  return { preset, audioFormat, clip, accurate: !!(payload.accurate && clip) };
}

// Blocks ProRes jobs that wouldn't fit on the disk (free space under 1.2x the estimate).
function checkRoom(job, request, payload) {
  const estimate = presets.estimateBytes(request.preset, {
    width: (job.formats && job.formats[0] && job.formats[0].width) || 1920,
    height: (job.formats && job.formats[0] && job.formats[0].height) || 1080,
    fps: job.fps || 30,
    durationSec: request.clip ? (request.clip.end == null ? job.durationSec : request.clip.end) - request.clip.start : job.durationSec,
  });
  const free = freeSpace(payload.folder);
  if (estimate && free != null && free < estimate * 1.2) return errorFromCode('DISK_FULL', `Needs about ${estimate} bytes, ${free} free.`);
  return null;
}

// Cover image for conversions and captured streams; also the small copy for the History list.
async function finishThumbnails(job, file, want, ytdlpHandled) {
  const { ffmpegPath } = binaries.getPaths();
  const cover = await thumbs.makeCover({
    ffmpegPath,
    dir: path.join(jobs.tempDir(job), 'cover'),
    imageUrl: job.thumbnailUrl,
    headers: job.thumbnailHeaders || {},
    video: file,
    durationSec: job.durationSec,
  });
  if (!cover) return undefined;
  if (!ytdlpHandled) {
    if (want.save) thumbs.saveNextTo(cover, file);
    if (want.embed) await thumbs.embedCover({ ffmpegPath, file, cover });
  }
  return thumbs.makeSmall({ ffmpegPath, cover, dest: history.thumbPathFor(job.id) });
}

function describeQuality(job, q) {
  const choice = q || {};
  if (choice.kind === 'best') return 'Best quality';
  if (choice.kind === 'tier') return choice.label || 'Chosen height';
  if (choice.kind === 'format') {
    const option = (job.formats || []).find((f) => f.id === choice.formatId);
    return option ? option.label : 'Chosen format';
  }
  return 'Best compatible';
}

// One history entry per job. Only the page link the user pasted is kept: never a captured
// stream URL, a token or a password.
function recordHistory(job, status, { filePath, request, payload, thumbPath, errorCode }) {
  try {
    let bytes = 0;
    if (filePath) {
      try {
        bytes = fs.statSync(filePath).size;
      } catch {
        // moved already
      }
    }
    const clip = request.clip
      ? { startSec: request.clip.start, endSec: request.clip.end == null ? job.durationSec : request.clip.end }
      : undefined;
    history.upsert(
      {
        id: job.id,
        title: job.title,
        sourceUrl: job.sourceUrl,
        resolver: job.resolver,
        site: new URL(job.sourceUrl).hostname.replace(/^www\./, ''),
        outputPath: filePath || '',
        preset: request.preset,
        quality: describeQuality(job, payload.quality),
        qualityChoice: payload.quality,
        mode: payload.mode,
        audioFormat: request.audioFormat,
        clip,
        thumbPath,
        bytes,
        durationSec: clip ? clip.endSec - clip.startSec : job.durationSec,
        finishedAt: Date.now(),
        status,
        errorCode,
      },
      settings.getSettings().historyLimit
    );
  } catch (err) {
    console.warn(`History write failed: ${err.message}`);
  }
}

ipcMain.handle('history-list', (event, query) => history.list(query));
ipcMain.handle('history-thumb', (event, id) => history.thumbDataUrl(id));
ipcMain.handle('history-remove', (event, id) => history.remove(id));
ipcMain.handle('history-get', (event, id) => history.find(id));
ipcMain.handle('history-show', (event, id) => {
  const entry = history.find(id);
  if (entry && entry.outputPath && fs.existsSync(entry.outputPath)) shell.showItemInFolder(entry.outputPath);
});
ipcMain.handle('history-open', (event, id) => {
  const entry = history.find(id);
  if (entry && entry.outputPath && fs.existsSync(entry.outputPath)) return shell.openPath(entry.outputPath);
});
ipcMain.handle('history-copy-link', (event, id) => {
  const entry = history.find(id);
  if (entry) clipboard.writeText(entry.sourceUrl);
});
// Clearing asks first, in a native dialog, and says whether it went ahead.
ipcMain.handle('history-clear', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Clear History'],
    defaultId: 0,
    cancelId: 0,
    message: 'Clear download history?',
    detail: 'Downloaded files are not deleted.',
  });
  if (response !== 1) return false;
  history.clear();
  return true;
});

ipcMain.handle('start-download', async (event, payload) => {
  if (activeDownload) return { started: false, error: errorFromCode('UNKNOWN', 'A download is already running.') };
  const job = jobs.get(payload && payload.jobId);
  if (!job || !job.title) return { started: false, error: errorFromCode('UNKNOWN', 'Load a link first.') };
  if (typeof payload.folder !== 'string' || !path.isAbsolute(payload.folder)) {
    return { started: false, error: errorFromCode('PERMISSION', 'No folder chosen.') };
  }
  try {
    // A failed download is retried from the same job; its options are still in place.
    if (job.status === 'failed') jobs.transition(job, 'ready', { error: undefined });
    if (job.status !== 'ready') return { started: false, error: errorFromCode('UNKNOWN', `Job is ${job.status}.`) };
    await loadEncodersOnce();
    const request = resolveOutput(job, payload);
    const blocked = checkRoom(job, request, payload);
    if (blocked) {
      jobs.fail(job, blocked);
      return { started: false };
    }
    const thumbWant = {
      save: !!(payload.thumbnail && payload.thumbnail.save),
      embed: !!(payload.thumbnail && payload.thumbnail.embed),
    };
    // yt-dlp saves and embeds the thumbnail itself when it does the whole job; conversions and
    // captured streams get theirs from Downlink afterwards.
    const preset = presets.PRESETS[request.preset];
    const staged = (preset.convert && payload.mode !== 'video') || !!(job.resolver === 'sniff' && job.sniff && job.sniff.audio);
    const ytdlpThumbs = job.resolver === 'ytdlp' && !staged;
    jobs.transition(job, 'downloading', {
      error: undefined, cancelled: false, progress: { percent: 0 }, preset: request.preset, clip: request.clip || undefined,
      thumbnail: thumbWant,
    });
    activeDownload = startJob(
      {
        ...binaries.getPaths(),
        url: job.sourceUrl,
        folder: payload.folder,
        tempDir: jobs.tempDir(job),
        password: job.password,
        mode: payload.mode,
        ...resolveQuality(job, payload.quality),
        ...(job.resolver === 'sniff' ? sniffOptions(job, request, payload, binaries.getPaths()) : {}),
        audioFormat: request.audioFormat,
        clip: request.clip,
        duration: job.durationSec,
        preset: request.preset,
        encoders,
        accurate: request.accurate,
        keepOriginal: settings.getSettings().keepOriginal,
        saveThumbnail: ytdlpThumbs && thumbWant.save,
        embedThumbnail: ytdlpThumbs && thumbWant.embed,
      },
      {
        onProgress: (progress) => {
          setTaskbarProgress(progress);
          if (progress.stage === 'processing') {
            if (job.status === 'downloading') jobs.transition(job, 'processing', { progress });
            else jobs.update(job, { progress });
          } else if (job.status === 'downloading') {
            jobs.update(job, { progress });
          }
        },
        onComplete: async (result) => {
          clearTaskbar(true);
          // Finishing up (thumbnails, history) still counts as busy.
          activeDownload = { cancel() {} };
          let thumbPath;
          if (result.filePath && !result.existing) {
            try {
              if (job.status === 'downloading') jobs.transition(job, 'processing', { progress: { stage: 'processing', step: 'Thumbnail' } });
              thumbPath = await finishThumbnails(job, result.filePath, thumbWant, ytdlpThumbs);
            } catch (err) {
              console.warn(`Thumbnail step failed: ${err.message}`);
            }
          }
          if (result.filePath) savedFiles.add(result.filePath);
          recordHistory(job, 'done', { filePath: result.filePath, request, payload, thumbPath });
          activeDownload = null;
          jobs.transition(job, 'done', { outputPath: result.filePath || undefined, existing: !!result.existing });
          notifyComplete(result.filePath);
        },
        onError: (raw, source) => {
          activeDownload = null;
          clearTaskbar(false);
          const error = toFriendly(job, { raw }, source);
          recordHistory(job, 'failed', { request, payload, errorCode: error.code });
          jobs.fail(job, error);
        },
        onCancel: () => {
          activeDownload = null;
          clearTaskbar(false);
          if (quitWhenCancelled) app.quit();
          else jobs.transition(job, 'ready', { cancelled: true });
        },
      }
    );
    return { started: true };
  } catch (err) {
    activeDownload = null;
    jobs.fail(job, toFriendly(job, err));
    return { started: false };
  }
});

ipcMain.handle('cancel-download', () => {
  if (activeDownload) activeDownload.cancel();
});

// "Show in Finder" on an error: opens the folder the download was going to.
ipcMain.handle('open-folder', () => shell.openPath(settings.getSettings().lastFolder));

ipcMain.handle('show-in-folder', (event, filePath) => {
  if (savedFiles.has(filePath)) shell.showItemInFolder(filePath);
});

ipcMain.handle('open-file', (event, filePath) => {
  if (savedFiles.has(filePath)) return shell.openPath(filePath);
});

