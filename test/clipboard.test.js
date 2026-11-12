// Run with: node test/clipboard.test.js  (only the URL rules, which need no window)
const assert = require('assert');
// The module reads Electron's clipboard lazily; stand in for it so it loads under plain node.
require.cache[require.resolve('electron')] = undefined;
const Module = require('module');
const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { clipboard: { readText: () => '' } };
  return original.call(this, request, ...rest);
};
const { offerableUrl } = require('../src/clipboard-watch');

assert.strictEqual(offerableUrl('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
assert.strictEqual(offerableUrl('  https://vimeo.com/123  '), 'https://vimeo.com/123');
assert.strictEqual(offerableUrl('http://example.com/a'), 'http://example.com/a');
for (const bad of [
  '', 'hello world', 'https://a.com https://b.com', 'two words https://a.com', 'ftp://a.com/x', 'youtube.com/watch',
  'http://localhost:3000/x', 'http://127.0.0.1/x', 'http://10.1.2.3/x', 'http://192.168.1.5/x', 'http://172.20.0.1/x',
  'http://169.254.1.1/x', 'http://[::1]/x', 'http://printer.local/x', 'https://x.localhost/y',
  'https://a.com/\nhttps://b.com', 'x'.repeat(3000),
]) assert.strictEqual(offerableUrl(bad), null, JSON.stringify(bad.slice(0, 40)));
assert.strictEqual(offerableUrl('http://172.32.0.1/x'), 'http://172.32.0.1/x'); // outside the private range
console.log('clipboard ok');
