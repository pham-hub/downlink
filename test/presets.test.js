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

// Presets without an encoder are hidden.
assert.ok(!p.availablePresets({ h264: null }).includes('h264'));
assert.ok(p.availablePresets({ h264: null }).includes('wav'));
console.log('presets ok');
