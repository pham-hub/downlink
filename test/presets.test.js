// Run with: node test/presets.test.js
const assert = require('assert');
const p = require('../src/presets');

// ProRes 422 sizes from the spec: ~147 Mbps at 1080p30, ~590 Mbps at 2160p30 (per second: /8).
const gbPerHour1080 = p.estimateBytes('prores422', { width: 1920, height: 1080, fps: 30, durationSec: 3600 });
assert.ok(Math.abs(gbPerHour1080 / 1e9 - 66.15) < 0.5, gbPerHour1080);
const uhd = p.estimateBytes('prores422', { width: 3840, height: 2160, fps: 30, durationSec: 1 });
assert.ok(Math.abs((uhd * 8) / 1e6 - 588) < 3, uhd);
assert.ok(p.estimateBytes('prores422', { width: 1920, height: 1080, fps: 60, durationSec: 1 }) === 2 * p.estimateBytes('prores422', { width: 1920, height: 1080, fps: 30, durationSec: 1 }));
assert.strictEqual(p.estimateBytes('h264', { durationSec: 10 }), undefined);

// Odd dimensions get the even-size filter, even ones don't; colour tags are copied when known.
const enc = { h264: 'libx264', prores: 'prores_ks' };
const odd = p.buildConvertArgs({ presetId: 'prores422', encoders: enc, probeInfo: { width: 1919, height: 1081, primaries: 'bt709', trc: 'bt709', space: 'bt709' }, input: 'in.mkv', output: 'out.mov' });
assert.ok(odd.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2') && odd.includes('-color_primaries') && odd.includes('prores_ks'));
const even = p.buildConvertArgs({ presetId: 'prores422', encoders: enc, probeInfo: { width: 1920, height: 1080 }, input: 'in.mkv', output: 'out.mov' });
assert.ok(!even.includes('-vf') && !even.includes('-color_primaries'));
const vt = p.buildConvertArgs({ presetId: 'h264', encoders: { h264: 'h264_videotoolbox' }, probeInfo: { width: 1920, height: 1080, bitRate: 20e6 }, input: 'in.mkv', output: 'out.mp4' });
assert.ok(vt.includes('h264_videotoolbox') && vt.includes('20000000') && vt.includes('+faststart'));

// Presets without an encoder are hidden.
assert.ok(!p.availablePresets({ h264: null, prores: null }).includes('h264'));
assert.ok(p.availablePresets({ h264: null, prores: null }).includes('wav'));
console.log('presets ok');
