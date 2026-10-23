# Downlink

A simple Mac app for downloading videos and audio. Paste or drop a link, pick a quality, download. No queue, no playlists, no history — just the basics.

## Download

**[Download for Apple Silicon Macs (M1 and newer)](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-arm64.dmg)**

**[Download for Intel Macs](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-x64.dmg)**

Not sure which? Open the Apple menu → **About This Mac**. If it says **Chip: Apple M…**, get Apple Silicon. If it says **Processor: … Intel**, get Intel. Needs macOS 12 Monterey or later.

**Installing**

1. Open the downloaded `.dmg` and drag **Downlink** into **Applications**.
2. Open Downlink. The first time, macOS blocks it with *Apple could not verify "Downlink" is free of malware*. Click **Done**.
3. Open **System Settings → Privacy & Security**, scroll down to the message about Downlink, and click **Open Anyway**.

You only do step 3 once. It happens because Downlink isn't signed with a paid Apple Developer account; any unsigned Mac app gets the same prompt. (On macOS 14 and earlier, right-clicking the app and choosing **Open** also works.)

**Updating:** download the newest file from the links above and drag it into Applications again, replacing the old one. You rarely need to: the part that talks to video sites (yt-dlp) updates itself in the background.

## What it supports

Works with YouTube, TikTok, SoundCloud, and most other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports. **Vimeo isn't supported**: it only allows downloads when signed in, and the app deliberately doesn't handle accounts.

Everything it needs ships inside the app: `yt-dlp`, `ffmpeg`/`ffprobe`, and [Deno](https://deno.com) (the JavaScript runtime yt-dlp uses to solve YouTube's player challenges). No Python, pip, or Homebrew required, and it works offline from the first launch. yt-dlp and Deno then keep themselves up to date in the background.

## Running from source

Needs [Node.js](https://nodejs.org/) 18+ (only for developing or building the app, not for using it).

```bash
git clone https://github.com/pham-hub/downlink.git
cd downlink
npm install
npm start
```

The first `npm start` downloads the tools for this Mac into `vendor/<arch>/` (about 20 seconds); later runs reuse them. `npm run fetch-tools` refreshes them to the latest yt-dlp and Deno.

## Building

```bash
npm run dist
```

Fetches the tools for both Apple Silicon and Intel, then uses `electron-builder` to produce one `.dmg` per architecture in `dist/`: `Downlink-arm64.dmg` and `Downlink-x64.dmg`. Separate builds keep each download about half the size of a universal one.

`npm run install-app` builds for this Mac only and copies it into `/Applications`.

Both commands ad-hoc sign the app after packaging (`scripts/after-pack.js`). That isn't Apple's Developer ID signing, but without it Apple Silicon Macs call the downloaded app "damaged" and offer no way to open it.

**Publishing a release:** bump `version` in `package.json`, run `npm run dist`, then:

```bash
gh release create v1.2.3 dist/Downlink-arm64.dmg dist/Downlink-x64.dmg --title "Downlink 1.2.3"
```

Keep the file names exactly as they are (no version number): the Download links above point at whichever release is newest, and only work if every release uses the same names.

## What the app does on your Mac

Written for anyone checking that the app does only what it says. Everything below can be confirmed in `src/`.

**Network.** The app contacts only:
- the site of the video link you paste, through yt-dlp, to read its details and download it;
- `github.com` (and GitHub's download servers), to check for and download newer releases of [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) and [Deno](https://github.com/denoland/deno/releases). Each download is checked against the SHA-256 checksum the project publishes and test-run before it's used (`src/tool-sources.js`, `src/binaries.js`).

There is no analytics, tracking, account, or server of its own. Nothing about you or your downloads is sent anywhere.

**Files.** It writes only:
- the videos/audio you download, into the folder you choose (partial files are removed if a download fails or is cancelled);
- `~/Library/Application Support/Downlink/`: `settings.json` (your last choices and folder) and `tools/` (newer yt-dlp/Deno copies).

**Programs.** It runs only the copies of yt-dlp, Deno, ffmpeg and ffprobe inside the app or in its `tools/` folder, never anything from Homebrew or `PATH`. Arguments are passed directly (no shell), and the pasted link always comes after `--`, so it can't be read as an option.

**Window.** The page has a strict Content-Security-Policy, runs sandboxed without Node access, can't navigate away from the app or open new windows, and can only open or reveal files the app itself saved (`src/main.js`).

## How it works

- **Bundled tools**: `scripts/fetch-tools.js` downloads the yt-dlp folder build (`yt-dlp_macos.zip`, which starts in a fraction of a second, unlike the single-file build), Deno, and signed/notarized static `ffmpeg` + `ffprobe` builds from [martin-riedl.de](https://ffmpeg.martin-riedl.de). Every download is checked against its publisher's SHA-256 checksum. `electron-builder` copies `vendor/<arch>/` into the app's `Contents/Resources/bin`.
- **Always its own copies**: the app never uses Homebrew or anything on `PATH`, and passes `--ignore-config`, so every Mac runs exactly the versions that shipped (or newer ones it fetched itself).
- **Background updates**: shortly after launch and every 6 hours, the app checks GitHub for newer yt-dlp and Deno releases. A newer one is downloaded to `~/Library/Application Support/Downlink/tools/`, checksum-verified, test-run, and then used from the next download on. If anything fails (offline, bad download), it keeps using what it has. ffmpeg is pinned in `src/tool-sources.js` and only changes with app releases.
- **Fetch Info**: Runs `yt-dlp --dump-single-json --flat-playlist` on the pasted (or dropped) link and builds a simplified quality list. Playlist and channel links are recognized in a second or two and turned away rather than looked up video by video; live streams are turned away too.
- **Download**: Runs `yt-dlp` with the selected format, codec preference, and destination folder, parsing its `--newline` progress output to drive the progress bar. Non-default choices are added to the file name (e.g. `Title (720p, H.264, video only).mp4`) so different versions of one video don't overwrite or get mistaken for each other.

## Project structure

```
src/main.js          Electron main process, window + IPC wiring
src/binaries.js      Picks bundled vs. updated tools; background updates
src/tool-sources.js  Where yt-dlp/Deno/ffmpeg come from; verified downloads
src/downloader.js    yt-dlp fetch-info & download process handling
src/formats.js       Builds the simplified quality dropdown
src/settings.js      Persists mode, quality, codec, format, and folder
src/preload.js       contextBridge API exposed to the renderer
scripts/fetch-tools.js  Downloads the tools into vendor/ before a build
scripts/after-pack.js   Ad-hoc signs the packaged app (see "Building")
scripts/make-icon.js    Renders build/icon.svg into the app icon (`npm run icon`)
renderer/            UI (HTML/CSS/JS)
```

## Third-party software

Downlink's own code is MIT-licensed (see `LICENSE`). The app also includes these separate programs, which it runs and which keep their own licenses:

- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**, [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE). Its macOS build includes Python and other libraries; their licenses are in `Downlink.app/Contents/Resources/bin/yt-dlp/_internal/THIRD_PARTY_LICENSES.txt`.
- **[Deno](https://github.com/denoland/deno)**, [MIT](https://github.com/denoland/deno/blob/main/LICENSE.md).
- **[FFmpeg](https://ffmpeg.org) 9.0.2** (`ffmpeg` and `ffprobe`), static builds by [Martin Riedl](https://ffmpeg.martin-riedl.de), licensed under the [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.html). Source code: [ffmpeg-9.0.2.tar.xz](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz). The build scripts are at [git.martin-riedl.de/ffmpeg/build-script](https://git.martin-riedl.de/ffmpeg/build-script), and the exact build configuration is listed in [versions.txt](https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/versions.txt).
