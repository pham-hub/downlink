# Downlink

A simple app for Mac and Windows for downloading videos and audio from YouTube, TikTok, SoundCloud and most other sites. Paste a link, pick a format and quality, and download.

## Download

- **Mac:** [Download for Mac](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-arm64.dmg). Apple Silicon (M1 and newer) only, macOS 12 or later.
- **Windows:** [Download for Windows](https://github.com/pham-hub/downlink/releases/latest/download/Downlink-Setup-x64.exe). 64-bit Windows 10 or later.

The apps aren't code-signed, so the first launch shows a warning. On Windows, click **More info**, then **Run anyway**. On Mac, use **Open Anyway** in System Settings > Privacy & Security.

## Features

- Video + audio, video only, or audio only (MP3, M4A, WAV, original)
- Best compatible (H.264), best quality, a set height, or any individual format
- Convert to H.264 (offered only when the best video isn't H.264); WAV for audio
- Clip a range by seconds, `MM:SS`, `HH:MM:SS.mmm` or frame timecode, with an accurate-cut option
- Stream capture for pages yt-dlp can't read, such as Frame.io shares (no DRM, no sign-in)
- Password prompt for protected videos
- Save and embed thumbnails
- History with re-download, and a clipboard watch that offers copied links
- Drag a link onto the window to load it
- On Windows, download progress shows on the taskbar button

Playlists, channels, DRM-protected video and anything that needs a sign-in aren't supported.

## Building from source

Requires Node.js 18 or later.

```bash
git clone https://github.com/pham-hub/downlink.git
cd downlink
npm install
npm start          # run the app
npm run dist       # build for the current OS into dist/ (Mac: Downlink-arm64.dmg, Windows: Downlink-Setup-x64.exe)
```

yt-dlp, Deno and FFmpeg are bundled into the app at build time, so nothing else needs to be installed. yt-dlp and Deno update themselves in the background.

### Releasing

Pushing a version tag builds the Windows installer on GitHub and starts a **draft** release with `RELEASE_NOTES.md` as its text (see `.github/workflows/release.yml`):

```bash
git tag v1.2.3
git push origin v1.2.3
```

The Mac app is built, signed and notarized on a Mac. Add its files to the draft, then publish it:

```bash
gh release upload v1.2.3 dist/Downlink-arm64.dmg dist/Downlink-arm64.zip dist/Downlink-arm64.dmg.blockmap dist/latest-mac.yml
```

The app checks GitHub Releases for newer versions of itself (Settings > Updates turns it off), so every release needs the `latest*.yml` files and the `.zip`.

For a signed and notarized Mac build with an Apple Developer ID, see [SIGNING.md](SIGNING.md).

## Credits

Downlink is MIT licensed. It includes [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [Deno](https://github.com/denoland/deno) (MIT) and [FFmpeg](https://ffmpeg.org) 9.0.2 (GPL v3, [source](https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz)). The Mac build of FFmpeg is by [Martin Riedl](https://ffmpeg.martin-riedl.de) ([build scripts](https://git.martin-riedl.de/ffmpeg/build-script)); the Windows build is by [BtbN](https://github.com/BtbN/FFmpeg-Builds) ([build scripts](https://github.com/BtbN/FFmpeg-Builds)).
