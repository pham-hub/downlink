// Run with: node test/presets.test.js
const assert = require('assert');
const p = require('../src/presets');

// Odd dimensions get the even-size filter, even ones don't; colour tags are copied when known.
const enc = { h264: 'libx264' };
const odd = p.buildConvertArgs({ presetId: 'h264', encoders: enc, probeInfo: { width: 1919, height: 1081, primaries: 'bt709', trc: 'bt709', space: 'bt709' }, input: 'in.mkv', output: 'out.mp4' });
assert.ok(odd.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2') && odd.includes('-color_primaries') && odd.includes('libx264'));
const even = p.buildConvertArgs({ presetId: 'h264', encoders: enc, probeInfo: { width: 1920, height: 1080 }, input: 'in.mkv', output: 'out.mp4' });
assert.ok(!even.includes('-vf') && !even.includes('-color_primaries'));
assert.ok(!Object.keys(p.PRESETS).some((id) => /prores/.test(id)));
const vt = p.buildConvertArgs({ presetId: 'h264', encoders: { h264: 'h264_videotoolbox' }, probeInfo: { width: 1920, height: 1080, bitRate: 20e6 }, input: 'in.mkv', output: 'out.mp4' });
assert.ok(vt.includes('h264_videotoolbox') && vt.includes('20000000') && vt.includes('+faststart'));

// A clip whose file runs long is cut to its last `length` seconds; a right-sized one is left alone.
assert.deepStrictEqual(p.clipWindow({ start: 60, end: 75 }, 600, 25), { start: 10, length: 15 });
assert.deepStrictEqual(p.clipWindow({ start: 60, end: null }, 100, 50), { start: 10, length: 40 });
assert.strictEqual(p.clipWindow({ start: 60, end: 75 }, 600, 15.008), null);
assert.strictEqual(p.clipWindow({ start: 60, end: null }, null, 50), null);
assert.strictEqual(p.clipWindow(null, 600, 25), null);
const cut = p.buildConvertArgs({ presetId: 'h264', encoders: enc, probeInfo: {}, input: 'in.mkv', output: 'out.mp4', trim: { start: 10, length: 15 } });
assert.ok(cut.join(' ').includes('-ss 10 -t 15 -i in.mkv'));
assert.ok(p.buildConvertArgs({ presetId: 'wav', encoders: enc, input: 'in.mkv', output: 'o.wav', trim: { start: 2, length: 5 } }).join(' ').includes('-ss 2 -t 5 -i in.mkv'));

// Presets without an encoder are hidden.
assert.ok(!p.availablePresets({ h264: null }).includes('h264'));
assert.ok(p.availablePresets({ h264: null }).includes('wav'));
console.log('presets ok');
