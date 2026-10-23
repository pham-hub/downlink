# Downlink

A simple Mac app for downloading videos and audio from YouTube, TikTok, SoundCloud and most other sites. Paste a link, pick a format and quality, and download.

## Download

- [Apple Silicon (M1 and newer)](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-arm64.dmg)
- [Intel](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-x64.dmg)

Not sure which? Go to Apple menu > About This Mac. If it says "Chip: Apple M...", you have Apple Silicon. Requires macOS 12 or later.

## Install

1. Open the .dmg and drag Downlink into Applications.
2. Open Downlink. macOS will say it can't verify the app. Click Done.
3. Go to System Settings > Privacy & Security, scroll down, and click Open Anyway.

You only need to do this once. It happens because the app isn't signed with a paid Apple developer account.

## Features

- Video + audio, video only, or audio only (MP3, M4A, WAV)
- Choose the quality, and sharper AV1/VP9 or more compatible H.264
- Download just part of a video
- Drag a link onto the window to load it

Playlists, channels and Vimeo aren't supported.

## Building from source

Requires Node.js 18 or later.

```bash
git clone https://github.com/pham-hub/downlink.git
cd downlink
npm install
npm start      # run the app
npm run dist   # build Downlink-arm64.dmg and Downlink-x64.dmg into dist/
```

yt-dlp, Deno and FFmpeg are bundled into the app at build time, so nothing else needs to be installed. yt-dlp and Deno update themselves in the background.

To publish a new version, bump the version in package.json, run `npm run dist`, and upload both files with the same names so the download links keep working:

```bash
gh release create v1.2.3 dist/Downlink-arm64.dmg dist/Downlink-x64.dmg
```

## Credits

Downlink is MIT licensed. It includes [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [Deno](https://github.com/denoland/deno) (MIT) and [FFmpeg](https://ffmpeg.org) 9.0.2 built by [Martin Riedl](https://ffmpeg.martin-riedl.de) (GPL v3, [source](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz), [build scripts](https://git.martin-riedl.de/ffmpeg/build-script)).
