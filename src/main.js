const { app, BrowserWindow, Menu, ipcMain, dialog, shell, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const binaries = require('./binaries');
const settings = require('./settings');
const { fetchInfo, startDownload } = require('./downloader');
const { summarizeFormats } = require('./formats');
const { JobStore } = require('./jobs');
const { friendlyError, errorFromCode } = require('./errors/map');

const WINDOW_WIDTH = 600;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

const jobs = new JobStore();

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
  mainWindow.on('focus', () => mainWindow.flashFrame(false));

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
  createWindow();
  setTimeout(updateTools, 5000);
  setInterval(updateTools, UPDATE_CHECK_INTERVAL);
});

// A single-window utility: closing the window quits, so a download is never left running unseen.
app.on('window-all-closed', () => app.quit());

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

// Vimeo only allows downloads when signed in, which this app deliberately doesn't do.
function isVimeo(url) {
  try {
    return /(^|\.)vimeo\.com$/i.test(new URL(url.trim()).hostname);
  } catch {
    return false;
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
  if (isVimeo(url)) return { success: false, error: errorFromCode('VIMEO') };

  let job;
  try {
    job = jobs.create(url.trim(), settings.getSettings());
  } catch (err) {
    return { success: false, error: errorFromCode('UNKNOWN', err.message) };
  }
  jobs.transition(job, 'resolving');
  try {
    const task = fetchInfo(binaries.getPaths(), job.sourceUrl);
    job.task = task;
    const info = await task;
    // The user moved on to another link while this one loaded.
    if (jobs.get(job.id) !== job) return { success: false, stale: true };
    const formats = summarizeFormats(info);
    jobs.transition(job, 'ready', { title: info.title, durationSec: info.duration || undefined, task: undefined });
    return {
      success: true,
      jobId: job.id,
      info: {
        title: info.title,
        uploader: info.uploader || info.channel || info.creator || null,
        duration: info.duration || null,
        thumbnail: info.thumbnail || null,
        site: info.extractor_key || null,
      },
      formats,
    };
  } catch (err) {
    if (jobs.get(job.id) !== job) return { success: false, stale: true };
    const error = toFriendly(job, err);
    jobs.fail(job, error);
    return { success: false, jobId: job.id, error };
  }
});

// The link was edited or cleared: whatever was loaded for it no longer applies.
ipcMain.handle('discard-job', (event, id) => {
  const job = jobs.get(id);
  if (job && !jobs.isBusy()) jobs.discard();
});

ipcMain.handle('get-settings', () => settings.getSettings());
ipcMain.handle('save-settings', (event, partial) => settings.saveSettings(partial));

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
    jobs.transition(job, 'downloading', { error: undefined, cancelled: false, progress: { percent: 0 } });
    activeDownload = startDownload(
      {
        ...binaries.getPaths(),
        url: job.sourceUrl,
        folder: payload.folder,
        tempDir: jobs.tempDir(job),
        mode: payload.mode,
        resolution: Number.isInteger(payload.resolution) ? payload.resolution : null,
        qualityLabel: payload.qualityLabel,
        audioFormat: payload.audioFormat,
        videoCodec: payload.videoCodec,
        clip: validClip(payload.clip),
        duration: job.durationSec,
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
        onComplete: (result) => {
          activeDownload = null;
          clearTaskbar(true);
          if (result.filePath) savedFiles.add(result.filePath);
          jobs.transition(job, 'done', { outputPath: result.filePath || undefined, existing: !!result.existing });
          notifyComplete(result.filePath);
        },
        onError: (raw) => {
          activeDownload = null;
          clearTaskbar(false);
          jobs.fail(job, toFriendly(job, { raw }));
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

