// Runs in the hidden capture window before any page script. It wraps the browser's DRM entry
// point so the app learns when a page asks for a content-decryption module. The page never
// sees a difference, and Downlink never tries to get around DRM (spec section 1).
const { webFrame } = require('electron');

// webFrame runs this in the page's own world, where the page will look for the function.
webFrame.executeJavaScript(`(() => {
  const nav = window.navigator;
  if (!nav || typeof nav.requestMediaKeySystemAccess !== 'function') return;
  const original = nav.requestMediaKeySystemAccess.bind(nav);
  nav.requestMediaKeySystemAccess = function (...args) {
    console.debug('__DOWNLINK_DRM__');
    return original(...args);
  };
})()`);
