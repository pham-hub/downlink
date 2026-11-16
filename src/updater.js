// Updates to Downlink itself (the app shell), from GitHub Releases.
//
// A newer release downloads quietly in the background and installs the next time the app
// quits; the window only gets a small "Update ready" notice with a Restart button. Only the
// version number is sent to GitHub. yt-dlp and Deno update separately (src/binaries).
// "Update now" (Settings, or Check for Updates… in the Mac app menu) checks straight away,
// shows the download and restarts into the new version when it's in. Nothing restarts while
// a video is downloading. Off in `npm start` (nothing to replace); the Settings switch turns
// off only the background checks.

const { app } = require('electron');

const CHECK_INTERVAL = 12 * 60 * 60 * 1000;

let updater = null;
let ready = null;
let send = () => {};
let isBusy = () => false;
// What the Settings row shows: idle, checking, downloading, ready, latest, error or unavailable.
let status = { state: 'idle' };
// Set by "Update now": restart as soon as the update is in.
let installWhenReady = false;

// `requested` tells the window the person pressed Update now (progress shows, then a restart).
function setStatus(next) {
  status = { ...next, requested: installWhenReady };
  send('update-status', status);
}

// send(channel, data) reaches the window; isEnabled() reads the Settings switch; busy() is
// true while a video is downloading.
function start({ send: sendFn, isEnabled, busy }) {
  send = sendFn;
  if (busy) isBusy = busy;
  const testFeed = process.env.DOWNLINK_TEST_UPDATE_URL; // dev-only: a stand-in release feed
  if (!app.isPackaged && !testFeed) {
    status = { state: 'unavailable' };
    return;
  }
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    status = { state: 'unavailable' };
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  if (testFeed) {
    updater.forceDevUpdateConfig = true;
    updater.setFeedURL({ provider: 'generic', url: testFeed });
  }
  // Background downloads report here too, so Settings shows one that's already under way.
  updater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  updater.on('download-progress', (p) => {
    if (status.state === 'downloading') setStatus({ ...status, percent: Math.floor(p.percent || 0) });
  });
  updater.on('update-not-available', () => {
    if (status.state === 'checking') setStatus({ state: 'latest', version: app.getVersion() });
  });
  updater.on('update-downloaded', (info) => {
    ready = { version: info.version };
    setStatus({ state: 'ready', version: info.version });
    if (installWhenReady) installNow();
  });
  updater.on('error', (err) => {
    if (testFeed) console.log('[updater] error:', err && err.message); // a background check fails silently
    if (status.state === 'checking' || status.state === 'downloading') setStatus({ state: 'error' });
    installWhenReady = false;
  });

  const check = () => {
    if (!isEnabled() || ready || status.state === 'checking' || status.state === 'downloading') return;
    updater.checkForUpdates().catch(() => {});
  };
  // Right after launch, once the window is up.
  setTimeout(check, 2 * 1000);
  setInterval(check, CHECK_INTERVAL);
}

// "Update now": check, download, then restart into the new version.
function updateNow() {
  if (!updater) return status;
  installWhenReady = true;
  if (ready) {
    installNow();
    return status;
  }
  // A background download already under way just carries on; its progress now shows.
  if (status.state === 'downloading') {
    setStatus(status);
  } else {
    setStatus({ state: 'checking' });
    updater.checkForUpdates().then(
      (result) => {
        // electron-updater resolves without an event when there's no update (or no feed).
        if (!result && status.state === 'checking') setStatus({ state: 'latest', version: app.getVersion() });
      },
      () => {
        if (status.state === 'checking') setStatus({ state: 'error' });
        installWhenReady = false;
      }
    );
  }
  return status;
}

// Restart into the downloaded update, unless a video is downloading. Then it waits for the
// person to press Restart again (or installs at quit).
function installNow() {
  if (!updater || !ready) return false;
  if (isBusy()) {
    installWhenReady = false;
    return false;
  }
  setStatus({ state: 'restarting', version: ready.version });
  // Let the window show "Restarting…" before it closes.
  setTimeout(() => updater.quitAndInstall(), 300);
  return true;
}

module.exports = { start, updateNow, installNow, status: () => status };
