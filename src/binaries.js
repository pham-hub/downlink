const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const sources = require('./tool-sources');

// yt-dlp and Deno get newer copies in the background (sites change often); ffmpeg only
// changes with app releases.
const UPDATABLE = {
  ytDlp: { latest: sources.latestYtDlp, install: (version, dir) => sources.installYtDlp(version, dir) },
  deno: { latest: sources.latestDeno, install: (version, dir) => sources.installDeno(version, process.arch, dir) },
};

const LABELS = { ytDlp: 'yt-dlp', deno: 'Deno', ffmpeg: 'ffmpeg' };

// The copies shipped inside the app (fetched by scripts/fetch-tools.js).
function bundledDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'vendor', process.arch);
}

// Newer copies downloaded after install, one folder per tool version.
function updatesDir() {
  return path.join(app.getPath('userData'), 'tools');
}

function updatedDir(tool, version) {
  return path.join(updatesDir(), `${tool}-${version}`);
}

function readUpdated() {
  try {
    return JSON.parse(fs.readFileSync(path.join(updatesDir(), 'current.json'), 'utf8'));
  } catch {
    return {};
  }
}

function writeUpdated(updated) {
  fs.mkdirSync(updatesDir(), { recursive: true });
  fs.writeFileSync(path.join(updatesDir(), 'current.json'), JSON.stringify(updated, null, 2));
}

// Always the app's own copies (never Homebrew or PATH), so every Mac runs what was tested:
// the bundled one, or a newer one fetched in the background.
function resolveTools() {
  const bundled = sources.readVersions(bundledDir());
  const updated = readUpdated();
  const tools = {};
  for (const [tool, rel] of Object.entries(sources.LAYOUT)) {
    let file = path.join(bundledDir(), rel);
    let version = bundled[tool];
    const newer = updated[tool];
    const newerFile = newer && path.join(updatedDir(tool, newer), rel);
    if (newer && (!version || sources.compareVersions(newer, version) > 0) && fs.existsSync(newerFile)) {
      file = newerFile;
      version = newer;
    }
    if (!fs.existsSync(file)) {
      throw new Error(
        app.isPackaged
          ? `Downlink is missing its built-in ${LABELS[tool]}. Reinstall the app.`
          : `Missing ${LABELS[tool]}. Run "npm run fetch-tools".`
      );
    }
    tools[tool] = { path: file, version };
  }
  return tools;
}

function getPaths() {
  const tools = resolveTools();
  return { ytDlpPath: tools.ytDlp.path, denoPath: tools.deno.path, ffmpegPath: tools.ffmpeg.path };
}

function getVersions() {
  try {
    const tools = resolveTools();
    return Object.fromEntries(Object.entries(tools).map(([tool, info]) => [tool, info.version || null]));
  } catch {
    return null;
  }
}

// Clears out superseded downloads. Runs at launch, before anything can be using them.
function removeStaleCopies() {
  // Earlier versions downloaded yt-dlp/ffmpeg here on first launch.
  fs.rmSync(path.join(app.getPath('userData'), 'bin'), { recursive: true, force: true });

  const bundled = sources.readVersions(bundledDir());
  const updated = readUpdated();
  let changed = false;
  for (const tool of Object.keys(updated)) {
    // An app update can bring a bundled copy as new as the downloaded one.
    if (bundled[tool] && sources.compareVersions(updated[tool], bundled[tool]) <= 0) {
      delete updated[tool];
      changed = true;
    }
  }
  if (changed) writeUpdated(updated);

  const keep = new Set(Object.entries(updated).map(([tool, version]) => `${tool}-${version}`));
  let entries = [];
  try {
    entries = fs.readdirSync(updatesDir(), { withFileTypes: true });
  } catch {
    return;
  }
  entries
    .filter((entry) => entry.isDirectory() && !keep.has(entry.name))
    .forEach((entry) => fs.rmSync(path.join(updatesDir(), entry.name), { recursive: true, force: true }));
}

function runsOk(file) {
  return new Promise((resolve, reject) => {
    execFile(file, ['--version'], { timeout: 60000 }, (err) => (err ? reject(err) : resolve()));
  });
}

async function updateTool(tool, current) {
  const { latest, install } = UPDATABLE[tool];
  const version = await latest();
  if (current.version && sources.compareVersions(version, current.version) <= 0) return false;

  // Install into a staging folder and only switch over once it verifiably runs.
  const dir = updatedDir(tool, version);
  const staging = `${dir}.partial`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    await install(version, staging);
    await runsOk(path.join(staging, sources.LAYOUT[tool]));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(staging, dir);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  writeUpdated({ ...readUpdated(), [tool]: version });
  return true;
}

// Brings yt-dlp and Deno up to date. Downloads already running keep the copy they started
// with; the next one picks up the new version. Resolves to the tools that changed.
let updating = null;

function updateInBackground() {
  if (!updating) {
    updating = (async () => {
      const current = resolveTools();
      const changed = [];
      for (const tool of Object.keys(UPDATABLE)) {
        try {
          if (await updateTool(tool, current[tool])) changed.push(tool);
        } catch (err) {
          // Offline or a release hiccup: keep using what's there and try again later.
          console.warn(`${LABELS[tool]} update failed: ${err.message}`);
        }
      }
      return changed;
    })().finally(() => {
      updating = null;
    });
  }
  return updating;
}

module.exports = { getPaths, getVersions, removeStaleCopies, updateInBackground };
