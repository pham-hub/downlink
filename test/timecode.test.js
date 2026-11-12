// Run with: node test/timecode.test.js
const assert = require('assert');
const T = require('../renderer/timecode');

const ok = (text, fps, value) => {
  const r = T.parse(text, fps);
  assert.ok(!r.error, `${text}: ${r.error}`);
  assert.ok(Math.abs(r.value - value) < 1e-9, `${text} -> ${r.value}, wanted ${value}`);
};
const bad = (text, fps) => assert.ok(T.parse(text, fps).error, `${text} should be rejected`);

ok('90', undefined, 90);
ok('90.5', undefined, 90.5);
ok('1:30', undefined, 90);
ok('1:02:03', undefined, 3723);
ok('1:02:03.250', undefined, 3723.25);
ok('90:00', undefined, 5400);
ok('00:00:01:12', 24, 1.5);               // 12 frames at 24 fps
ok('00:01:00:15', 30, 60.5);
assert.strictEqual(T.parse('').value, null);
bad('1:75'); bad('abc'); bad('1:2:3:4:5'); bad('00:00:01:12'); // no fps -> frame timecodes refused
bad('00:00:01:30', 30);                    // frame 30 doesn't exist at 30 fps
assert.strictEqual(T.compact(90), '000130');
assert.strictEqual(T.compact(3725), '010205');
assert.strictEqual(T.seconds3(90), '90.000');
assert.strictEqual(T.format(3725), '1:02:05');
console.log('timecode ok');
