// Tiny Chrome-DevTools-Protocol driver for smoke-testing the running app.
// Start the app with: node_modules/.bin/electron --remote-debugging-port=9333 .
const http = require('http');
function getJson(url) {
  return new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej));
}
async function connect(port = 9333) {
  const targets = await getJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === 'page' && /renderer\/index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const screenshot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); require('fs').writeFileSync(file, Buffer.from(r.result.data, 'base64')); };
  return { evaluate, screenshot, close: () => ws.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { connect, sleep };
