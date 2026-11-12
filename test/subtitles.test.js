// Run with: node test/subtitles.test.js
const assert = require('assert');
const { pickSubtitle } = require('../src/subtitles');

assert.strictEqual(pickSubtitle({}), null);
assert.strictEqual(pickSubtitle({ subtitles: { live_chat: [] } }), null);
assert.deepStrictEqual(pickSubtitle({ subtitles: { fr: [], 'en-US': [] } }), { lang: 'en-US', auto: false });
assert.deepStrictEqual(pickSubtitle({ subtitles: { ja: [] } }), { lang: 'ja', auto: false });
assert.deepStrictEqual(pickSubtitle({ automatic_captions: { en: [], 'en-orig': [] } }), { lang: 'en-orig', auto: true });
assert.deepStrictEqual(pickSubtitle({ subtitles: { de: [] }, automatic_captions: { en: [] } }), { lang: 'de', auto: false });
console.log('subtitles ok');
