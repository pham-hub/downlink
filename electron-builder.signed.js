// Signed and notarized build, for whoever has an Apple Developer ID:
//
//   APPLE_TEAM_ID=XXXXXXXXXX APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//     npm run dist:signed
//
// Same settings as the "build" section of package.json, except the app is signed with the
// "Developer ID Application" certificate in the keychain (or the one named by CSC_NAME) using the
// hardened runtime, then notarized. electron-builder's default entitlements are what the bundled
// Deno (JIT) and yt-dlp's Python need, so don't replace them with a stricter set.
const { build } = require('./package.json');

const teamId = process.env.APPLE_TEAM_ID;
if (!teamId) {
  throw new Error('Set APPLE_TEAM_ID (and APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD) to make a signed build.');
}

// package.json's identity: null turns signing off; leaving it out lets electron-builder find the certificate.
// eslint-disable-next-line no-unused-vars
const { identity, ...mac } = build.mac;

module.exports = {
  ...build,
  mac: {
    ...mac,
    hardenedRuntime: true,
    notarize: { teamId },
  },
};
