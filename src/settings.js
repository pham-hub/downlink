const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULTS = {
  mode: 'both',
  quality: 'best',
  audioFormat: 'mp3',
  videoCodec: 'best',
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

// Same folder the personal yt-dlp config saves to, else ~/Downloads.
function defaultFolder() {
  const preferred = path.join(os.homedir(), 'Desktop', 'Youtube Downloads');
  return fs.existsSync(preferred) ? preferred : app.getPath('downloads');
}

function getSettings() {
  const saved = readSettings();
  const lastFolder = saved.lastFolder && fs.existsSync(saved.lastFolder) ? saved.lastFolder : defaultFolder();
  return { ...DEFAULTS, ...saved, lastFolder };
}

function saveSettings(partial) {
  const allowed = ['mode', 'quality', 'audioFormat', 'videoCodec', 'lastFolder'];
  const settings = readSettings();
  allowed.forEach((key) => {
    if (key in partial) settings[key] = partial[key];
  });
  writeSettings(settings);
}

module.exports = { getSettings, saveSettings };
