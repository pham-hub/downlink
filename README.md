# Downlink

A simple Mac app for downloading videos and audio from YouTube, TikTok, SoundCloud and most other sites. Paste a link, pick a format and quality, and download.

## Download

[Download for Mac](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-arm64.dmg). Apple Silicon (M1 and newer) only, macOS 12 or later.

## Install

Open the .dmg and drag Downlink into Applications.

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

```bash
gh release create v1.2.3 dist/Downlink-arm64.dmg dist/Downlink-x64.dmg
```

For a signed and notarized build with an Apple Developer ID, see [SIGNING.md](SIGNING.md).

## Credits

Downlink is MIT licensed. It includes [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [Deno](https://github.com/denoland/deno) (MIT) and [FFmpeg](https://ffmpeg.org) 9.0.2 built by [Martin Riedl](https://ffmpeg.martin-riedl.de) (GPL v3, [source](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz), [build scripts](https://git.martin-riedl.de/ffmpeg/build-script)).
