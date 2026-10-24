// electron-builder hook: runs after the .app is assembled, before the .dmg is made.
//
// The app isn't signed with an Apple Developer ID, but Apple Silicon Macs refuse to run code
// with no valid signature at all ("is damaged and can't be opened", with no way around it).
// An ad-hoc signature fixes that, so people get the usual "Open Anyway" prompt instead.
// The bundled ffmpeg and Deno keep their own developers' signatures.
const path = require('path');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // A signed build (electron-builder.signed.js) gets a real signature after this hook instead.
  if (context.packager.platformSpecificBuildOptions.identity !== null) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
