// Updates to Downlink itself (the app shell), from GitHub Releases.
//
// A newer release downloads quietly in the background and installs the next time the app
// quits; the window only gets a small "Update ready" notice with a Restart button. Only the
// version number is sent to GitHub. yt-dlp and Deno update separately (src/binaries).
// Off in `npm start` (nothing to replace), and off when the person turned it off in Settings.

const { app } = require('electron');

const CHECK_INTERVAL = 12 * 60 * 60 * 1000;

let updater = null;
let ready = null;

// send(channel, data) reaches the window; isEnabled() reads the Settings switch.
function start({ send, isEnabled }) {
  const testFeed = process.env.DOWNLINK_TEST_UPDATE_URL; // dev-only: a stand-in release feed
  if (!app.isPackaged && !testFeed) return;
  try {
    updater = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  if (testFeed) {
    updater.forceDevUpdateConfig = true;
    updater.setFeedURL({ provider: 'generic', url: testFeed });
  }
  updater.on('update-downloaded', (info) => {
    ready = { version: info.version };
    send('update-ready', ready);
  });
  updater.on('error', (err) => {
    if (testFeed) console.log('[updater] error:', err && err.message); // a failed check is otherwise silent
  });

  const check = () => {
    if (!isEnabled() || ready) return;
    updater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 15 * 1000);
  setInterval(check, CHECK_INTERVAL);
}

// The person pressed Restart on the notice.
function installNow() {
  if (updater && ready) updater.quitAndInstall();
}

module.exports = { start, installNow, pending: () => ready };
