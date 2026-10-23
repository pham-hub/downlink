#!/usr/bin/env node
// Downloads yt-dlp, Deno and ffmpeg into vendor/<arch>/ so they ship inside the app.
//
//   node scripts/fetch-tools.js               this Mac's architecture, refreshed to the latest
//   node scripts/fetch-tools.js --all         arm64 and x64 (for `npm run dist`)
//   node scripts/fetch-tools.js --if-missing  skip the network when tools are already there
const fs = require('fs');
const path = require('path');
const sources = require('../src/tool-sources');

const VENDOR = path.join(__dirname, '..', 'vendor');
const args = process.argv.slice(2);
const arches = args.includes('--all') ? ['arm64', 'x64'] : [process.arch];
const ifMissing = args.includes('--if-missing');

function hasAll(dir) {
  return Object.values(sources.LAYOUT).every((rel) => fs.existsSync(path.join(dir, rel)));
}

async function main() {
  const pending = arches.filter((arch) => !(ifMissing && hasAll(path.join(VENDOR, arch))));
  if (!pending.length) return;

  const [ytDlp, deno] = await Promise.all([sources.latestYtDlp(), sources.latestDeno()]);

  for (const arch of pending) {
    const dir = path.join(VENDOR, arch);
    fs.mkdirSync(dir, { recursive: true });
    const have = hasAll(dir) ? sources.readVersions(dir) : {};

    if (have.ytDlp !== ytDlp) {
      console.log(`[${arch}] yt-dlp ${ytDlp}`);
      await sources.installYtDlp(ytDlp, dir);
    }
    if (have.deno !== deno) {
      console.log(`[${arch}] Deno ${deno}`);
      await sources.installDeno(deno, arch, dir);
    }
    if (have.ffmpeg !== sources.FFMPEG_VERSION) {
      console.log(`[${arch}] ffmpeg ${sources.FFMPEG_VERSION}`);
      await sources.installFfmpeg(arch, dir);
    }
    sources.writeVersions(dir, { ytDlp, deno, ffmpeg: sources.FFMPEG_VERSION });
    console.log(`[${arch}] tools ready in vendor/${arch}`);
  }
}

main().catch((err) => {
  console.error(`fetch-tools failed: ${err.message}`);
  process.exit(1);
});
