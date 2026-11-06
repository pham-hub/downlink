// Where yt-dlp, Deno and ffmpeg come from, and how to download them safely.
// Shared by scripts/fetch-tools.js (bundling at build time) and binaries.js (background updates),
// so it must not depend on Electron.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const USER_AGENT = 'downlink-app';

// Signed and notarized static builds. Pinned: ffmpeg rarely matters for downloads, and the
// site's "latest" redirects aren't reliable. Bump the folder names to upgrade.
const IS_WIN = process.platform === 'win32';
const FFMPEG_VERSION = '9.0.2';
const FFMPEG_BASE = {
  arm64: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2',
};
// Windows: BtbN's static GPL builds (zip holds <folder>/bin/ffmpeg.exe and ffprobe.exe).
// Pinned to the ffmpeg 9.0.2 release build (same version as the Mac app). BtbN prunes old
// autobuild tags eventually; if this 404s, pick a newer n9.x asset from their releases page.
const FFMPEG_WIN_BASE = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-06-12-50';
const FFMPEG_WIN_ZIP = 'ffmpeg-n9.0.2-47-gb204e94e90-win64-gpl-9.0.zip';

const DENO_TARGET = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-pc-windows-msvc' };

// The architecture folder name used under vendor/ (matches electron-builder's ${arch}).
const TARGET_ARCH = IS_WIN ? 'x64' : 'arm64';

// Folder layout inside a tools directory (bundled or updated).
const LAYOUT = {
  ytDlp: IS_WIN ? path.join('yt-dlp', 'yt-dlp.exe') : path.join('yt-dlp', 'yt-dlp_macos'),
  deno: IS_WIN ? path.join('deno', 'deno.exe') : path.join('deno', 'deno'),
  ffmpeg: IS_WIN ? path.join('ffmpeg', 'ffmpeg.exe') : path.join('ffmpeg', 'ffmpeg'),
};

// Compares dotted versions numerically, so "2026.8.19" equals "2026.08.19".
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

async function request(url, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function fetchText(url) {
  return (await request(url)).text();
}

async function fetchBuffer(url) {
  return Buffer.from(await (await request(url, 10 * 60 * 1000)).arrayBuffer());
}

// GitHub's /releases/latest page redirects to /releases/tag/<tag>; reading that avoids the
// rate-limited API.
async function latestGithubTag(repo) {
  const res = await fetch(`https://github.com/${repo}/releases/latest`, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  const match = /\/releases\/tag\/([^/?#]+)/.exec(res.headers.get('location') || '');
  if (!match) throw new Error(`Could not find the latest ${repo} release`);
  return decodeURIComponent(match[1]);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Checksum files are "<hash>  <filename>" lines (or just "<hash>").
function expectedHash(sumsText, fileName) {
  // Deno's Windows checksum is PowerShell Get-FileHash output ("Hash : <sha256>") for that one file.
  const ps = /^\s*Hash\s*:\s*([0-9a-f]{64})\s*$/im.exec(sumsText);
  if (ps && new RegExp(`Path\\s*:.*${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(sumsText)) {
    return ps[1].toLowerCase();
  }
  for (const line of sumsText.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (hash && (!name || name.replace(/^\*/, '') === fileName)) return hash.toLowerCase();
  }
  throw new Error(`No checksum listed for ${fileName}`);
}

async function downloadVerified(url, sumsUrl, fileName) {
  const [data, sums] = await Promise.all([fetchBuffer(url), fetchText(sumsUrl)]);
  if (sha256(data) !== expectedHash(sums, fileName)) {
    throw new Error(`Checksum mismatch for ${fileName}; refusing to install it`);
  }
  return data;
}

function unzip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    // Windows 10+ ships bsdtar, which reads zip files.
    const [cmd, args] = IS_WIN
      ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', destDir]]
      : ['/usr/bin/ditto', ['-x', '-k', zipPath, destDir]];
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}

async function unzipBuffer(data, destDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-tool-'));
  try {
    const zipPath = path.join(tmp, 'tool.zip');
    fs.writeFileSync(zipPath, data);
    fs.mkdirSync(destDir, { recursive: true });
    await unzip(zipPath, destDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function makeExecutable(filePath) {
  if (!IS_WIN) fs.chmodSync(filePath, 0o755);
}

function latestYtDlp() {
  return latestGithubTag('yt-dlp/yt-dlp');
}

async function latestDeno() {
  return (await latestGithubTag('denoland/deno')).replace(/^v/, '');
}

function relink(target, linkPath) {
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(target, linkPath);
}

// yt-dlp's zip stores the bundled Python.framework with its symlinks flattened into copies:
// Python, Resources and Versions/Current duplicate Versions/3.x. codesign rejects that layout
// ("bundle format is ambiguous"), which breaks Developer ID signing, so put the links back.
function relinkFrameworks(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.framework')) continue;
    const framework = path.join(dir, entry.name);
    const versionsDir = path.join(framework, 'Versions');
    if (!fs.existsSync(versionsDir) || fs.lstatSync(path.join(versionsDir, 'Current')).isSymbolicLink()) continue;
    const versions = fs.readdirSync(versionsDir).filter((v) => v !== 'Current');
    if (versions.length !== 1) continue;
    relink(versions[0], path.join(versionsDir, 'Current'));
    for (const name of fs.readdirSync(path.join(versionsDir, versions[0]))) {
      relink(path.join('Versions', 'Current', name), path.join(framework, name));
    }
    // PyInstaller also puts the library next to the framework ("_internal/Python").
    const binary = entry.name.replace(/\.framework$/, '');
    const sibling = path.join(dir, binary);
    if (fs.existsSync(sibling) && !fs.lstatSync(sibling).isSymbolicLink()) {
      relink(path.join(entry.name, 'Versions', 'Current', binary), sibling);
    }
  }
}

// The folder build ("yt-dlp_macos.zip") is universal and starts in a fraction of a second;
// the single-file build unpacks itself on every run and takes ~7s.
async function installYtDlp(version, toolsDir) {
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`;
  const zipName = IS_WIN ? 'yt-dlp_win.zip' : 'yt-dlp_macos.zip';
  const data = await downloadVerified(`${base}/${zipName}`, `${base}/SHA2-256SUMS`, zipName);
  const dir = path.join(toolsDir, 'yt-dlp');
  fs.rmSync(dir, { recursive: true, force: true });
  await unzipBuffer(data, dir);
  if (!IS_WIN) relinkFrameworks(path.join(dir, '_internal'));
  makeExecutable(path.join(toolsDir, LAYOUT.ytDlp));
}

async function installDeno(version, arch, toolsDir) {
  const name = `deno-${DENO_TARGET[arch]}.zip`;
  const base = `https://github.com/denoland/deno/releases/download/v${version}`;
  const data = await downloadVerified(`${base}/${name}`, `${base}/${name}.sha256sum`, name);
  const dir = path.join(toolsDir, 'deno');
  fs.rmSync(dir, { recursive: true, force: true });
  await unzipBuffer(data, dir);
  makeExecutable(path.join(toolsDir, LAYOUT.deno));
}

// ffprobe ships alongside ffmpeg: yt-dlp looks for it next to ffmpeg for some conversions.
async function installFfmpeg(arch, toolsDir) {
  const dir = path.join(toolsDir, 'ffmpeg');
  fs.rmSync(dir, { recursive: true, force: true });
  if (IS_WIN) {
    const data = await downloadVerified(`${FFMPEG_WIN_BASE}/${FFMPEG_WIN_ZIP}`, `${FFMPEG_WIN_BASE}/checksums.sha256`, FFMPEG_WIN_ZIP);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-ffmpeg-'));
    try {
      await unzipBuffer(data, tmp);
      const bin = path.join(tmp, fs.readdirSync(tmp)[0], 'bin');
      fs.mkdirSync(dir, { recursive: true });
      for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(bin, exe), path.join(dir, exe));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const url = `${FFMPEG_BASE[arch]}/${tool}.zip`;
    const data = await downloadVerified(url, `${url}.sha256`, `${tool}.zip`);
    await unzipBuffer(data, dir);
    makeExecutable(path.join(dir, tool));
  }
}

function readVersions(toolsDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(toolsDir, 'versions.json'), 'utf8'));
  } catch {
    return {};
  }
}

function writeVersions(toolsDir, versions) {
  fs.writeFileSync(path.join(toolsDir, 'versions.json'), JSON.stringify(versions, null, 2));
}

module.exports = {
  FFMPEG_VERSION,
  TARGET_ARCH,
  LAYOUT,
  compareVersions,
  latestYtDlp,
  latestDeno,
  installYtDlp,
  installDeno,
  installFfmpeg,
  readVersions,
  writeVersions,
};
