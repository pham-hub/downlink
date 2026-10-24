#!/usr/bin/env node
// Makes sure Electron's own app is unpacked before `npm start`.
//
// Electron's installer unzips with extract-zip, which stops partway on recent Node versions (26)
// and still exits cleanly, leaving "Electron failed to install correctly". Newer npm versions also
// skip that installer unless it's approved. Either way, this finishes the job with macOS's ditto.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dir = path.dirname(require.resolve('electron/package.json'));
const { version } = require('electron/package.json');
const PLATFORM_PATH = 'Electron.app/Contents/MacOS/Electron';

function isInstalled() {
  try {
    return (
      fs.readFileSync(path.join(dir, 'path.txt'), 'utf8') === PLATFORM_PATH &&
      fs.readFileSync(path.join(dir, 'dist', 'version'), 'utf8').replace(/^v/, '') === version &&
      fs.existsSync(path.join(dir, 'dist', PLATFORM_PATH))
    );
  } catch {
    return false;
  }
}

async function main() {
  if (process.platform !== 'darwin' || isInstalled()) return;
  const { downloadArtifact } = require('@electron/get');
  const zip = await downloadArtifact({ version, artifactName: 'electron', platform: 'darwin', arch: process.arch });
  const dist = path.join(dir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dist]);
  if (!fs.existsSync(path.join(dist, 'version'))) fs.writeFileSync(path.join(dist, 'version'), version);
  fs.writeFileSync(path.join(dir, 'path.txt'), PLATFORM_PATH);
  console.log(`Unpacked Electron ${version}`);
}

main().catch((err) => {
  console.error(`ensure-electron failed: ${err.message}`);
  process.exit(1);
});
