const { app, BrowserWindow, ipcMain, dialog, shell, Notification, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const binaries = require('./binaries');
const settings = require('./settings');
const { fetchInfo, startDownload } = require('./downloader');
const { summarizeFormats } = require('./formats');

const WINDOW_WIDTH = 600;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
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

app.whenReady().then(() => {
  // The packaged app gets its icon from build/icon.icns; this covers `npm start`.
  const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
  if (app.dock && !app.isPackaged && fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
  binaries.removeStaleCopies();
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

ipcMain.handle('fetch-info', async (event, url) => {
  try {
    if (!isWebUrl(url)) {
      return { success: false, error: 'Please enter a valid video URL.' };
    }
    if (isVimeo(url)) {
      return { success: false, error: "Vimeo isn't supported because it requires signing in." };
    }
    const info = await fetchInfo(binaries.getPaths(), url.trim());
    return {
      success: true,
      info: {
        title: info.title,
        uploader: info.uploader || info.channel || info.creator || null,
        duration: info.duration || null,
        thumbnail: info.thumbnail || null,
        site: info.extractor_key || null,
      },
      formats: summarizeFormats(info),
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
  if (activeDownload) return { started: false, error: 'A download is already running.' };
  if (!isWebUrl(payload.url)) return { started: false, error: 'Please enter a valid video URL.' };
  if (typeof payload.folder !== 'string' || !path.isAbsolute(payload.folder)) {
    return { started: false, error: 'Choose a folder to save into.' };
  }
  try {
    activeDownload = startDownload(
      {
        ...binaries.getPaths(),
        url: payload.url.trim(),
        folder: payload.folder,
        mode: payload.mode,
        height: Number.isInteger(payload.height) ? payload.height : null,
        qualityLabel: payload.qualityLabel,
        audioFormat: payload.audioFormat,
        videoCodec: payload.videoCodec,
        clip: validClip(payload.clip),
        duration: payload.duration,
      },
      {
        onProgress: (progress) => send('download-progress', progress),
        onComplete: (result) => {
          activeDownload = null;
          if (result.filePath) savedFiles.add(result.filePath);
          send('download-complete', result);
          notifyComplete(result.filePath);
        },
        onError: (message) => {
          activeDownload = null;
          send('download-error', { message });
        },
        onCancel: () => {
          activeDownload = null;
          if (quitWhenCancelled) app.quit();
          else send('download-cancelled');
        },
      }
    );
    return { started: true };
  } catch (err) {
    activeDownload = null;
    return { started: false, error: err.message };
  }
});

ipcMain.handle('cancel-download', () => {
  if (activeDownload) activeDownload.cancel();
});

ipcMain.handle('show-in-folder', (event, filePath) => {
  if (savedFiles.has(filePath)) shell.showItemInFolder(filePath);
});

ipcMain.handle('open-file', (event, filePath) => {
  if (savedFiles.has(filePath)) return shell.openPath(filePath);
});

