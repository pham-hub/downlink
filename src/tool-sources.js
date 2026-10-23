// Where yt-dlp, Deno and ffmpeg come from, and how to download them safely.
// Shared by scripts/fetch-tools.js (bundling at build time) and binaries.js (background updates),
// so it must not depend on Electron.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const USER_AGENT = 'video-downloader-app';

// Signed and notarized static builds. Pinned: ffmpeg rarely matters for downloads, and the
// site's "latest" redirects aren't reliable. Bump the folder names to upgrade.
const FFMPEG_VERSION = '9.0.2';
const FFMPEG_BASE = {
  arm64: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2',
  x64: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2',
};

const DENO_TARGET = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };

// Folder layout inside a tools directory (bundled or updated).
const LAYOUT = {
  ytDlp: path.join('yt-dlp', 'yt-dlp_macos'),
  deno: path.join('deno', 'deno'),
  ffmpeg: path.join('ffmpeg', 'ffmpeg'),
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
    execFile('/usr/bin/ditto', ['-x', '-k', zipPath, destDir], (err) => (err ? reject(err) : resolve()));
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
  fs.chmodSync(filePath, 0o755);
}

function latestYtDlp() {
  return latestGithubTag('yt-dlp/yt-dlp');
}

async function latestDeno() {
  return (await latestGithubTag('denoland/deno')).replace(/^v/, '');
}

// The folder build ("yt-dlp_macos.zip") is universal and starts in a fraction of a second;
// the single-file build unpacks itself on every run and takes ~7s.
async function installYtDlp(version, toolsDir) {
  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}`;
  const data = await downloadVerified(`${base}/yt-dlp_macos.zip`, `${base}/SHA2-256SUMS`, 'yt-dlp_macos.zip');
  const dir = path.join(toolsDir, 'yt-dlp');
  fs.rmSync(dir, { recursive: true, force: true });
  await unzipBuffer(data, dir);
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
