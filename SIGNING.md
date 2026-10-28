# Signing and notarizing Downlink

This builds `Downlink-arm64.dmg` (Apple Silicon) and `Downlink-x64.dmg` (Intel), signed with your Developer ID and notarized by Apple, so they open without the "can't verify" warning.

## You need

- A Mac with Node.js 18 or later and the Xcode command line tools (`xcode-select --install`).
- A **Developer ID Application** certificate (with its private key) in your login keychain. Check with:

  ```bash
  security find-identity -v -p codesigning
  ```

- Your Apple **Team ID** (10 characters, at developer.apple.com > Membership).
- An **app-specific password** for your Apple ID (account.apple.com > Sign-In and Security > App-Specific Passwords).

## Build

```bash
cd downlink
npm install
APPLE_TEAM_ID=XXXXXXXXXX \
APPLE_ID=you@example.com \
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
npm run dist:signed
```

This downloads the latest yt-dlp and Deno plus the pinned ffmpeg for both architectures. It then builds both apps, signs every binary inside them with your certificate using the hardened runtime, notarizes each app and staples the ticket. Notarizing takes a few minutes per app. The dmgs end up in `dist/`.

If you have more than one Developer ID certificate, pick one with `CSC_NAME="Developer ID Application: Your Name (XXXXXXXXXX)"`.

Newer npm versions warn that electron's install script isn't approved. That's fine: the build downloads Electron itself, and `npm start` unpacks it if needed (`scripts/ensure-electron.js`).

## Check the result

```bash
hdiutil attach dist/Downlink-arm64.dmg -nobrowse -mountpoint /tmp/dl
spctl -a -vv -t exec /tmp/dl/Downlink.app      # should say: accepted, source=Notarized Developer ID
xcrun stapler validate /tmp/dl/Downlink.app    # should say: The validate action worked!
hdiutil detach /tmp/dl
```

Do the same for `Downlink-x64.dmg`.

Optional: notarize and staple the dmg files too, so the first open also works offline:

```bash
xcrun notarytool submit dist/Downlink-arm64.dmg --apple-id you@example.com --team-id XXXXXXXXXX --password xxxx-xxxx-xxxx-xxxx --wait
xcrun stapler staple dist/Downlink-arm64.dmg
```

## Things that are already set up (don't change them)

- **Entitlements.** `electron-builder.signed.js` uses electron-builder's default entitlements (`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`) for the app and everything inside it. The bundled Deno needs JIT and crashes on launch without it. yt-dlp's bundled Python needs the other two. A stricter custom entitlements file will break downloads.
- **yt-dlp's Python framework.** yt-dlp's official zip flattens the symlinks in its `Python.framework`, which codesign refuses to sign ("bundle format is ambiguous"). `src/tool-sources.js` restores them when it unpacks yt-dlp, so this is handled automatically.
- **Background updates.** The app downloads newer yt-dlp and Deno releases into `~/Library/Application Support/Downlink/tools` (checksum-verified). Those run as separate programs, so they don't need your signature and don't affect the app's.
- **Unsigned builds.** `npm run dist` (no Developer ID) still makes ad-hoc signed dmgs that need the "Open Anyway" step.

The published release is the signed Apple Silicon build, so the README and the Downlink web page no longer have "Open Anyway" install steps.
