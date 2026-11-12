// Run with: node test/sniff.test.js  (the parts that don't need a window)
const assert = require('assert');
const hls = require('../src/sniff/hls');
const frameio = require('../src/sniff/adapters/frameio');

assert.strictEqual(hls.classifyPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nx.m3u8'), 'hls-master');
assert.strictEqual(hls.classifyPlaylist('#EXTM3U\n#EXTINF:6.0,\nseg.ts'), 'hls-media');
assert.strictEqual(hls.playlistDuration('#EXTINF:6.0,\na\n#EXTINF:4.5,\nb'), 10.5);
const master = hls.parseMaster('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,FRAME-RATE=23.976,CODECS="avc1.640028,mp4a.40.2"\nhi/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\nlo/index.m3u8', 'https://cdn.test/a/master.m3u8');
assert.strictEqual(master.length, 2);
assert.strictEqual(master[0].url, 'https://cdn.test/a/hi/index.m3u8');
assert.strictEqual(master[0].fps, 23.976);
assert.strictEqual(master[1].height, 360);

// Frame.io segment URLs match; other hosts and paths don't.
const seg = 'https://sahls.frame.io/encode-hls/abc123/token/eyJhbGciOi.eyJzdWIi.sig/h264_1080_best/12.m4s';
assert.ok(frameio.match({ url: seg }));
assert.ok(!frameio.match({ url: 'https://example.com/encode-hls/abc123/token/x/h264_1080_best/12.m4s' }));
assert.ok(!frameio.match({ url: 'https://sahls.frame.io/other/path.m4s' }));

// The adapter probes <base>/<rendition>/media-vid.m3u8 and keeps the ones that answer 200.
(async () => {
  const asked = [];
  const ctx = {
    pageUrl: 'https://f.io/x',
    pageTitle: async () => '26-27 SEA Open.mp4 - 26-27 SEA Open - Frame.io',
    posterUrl: async () => undefined,
    headersFor: (c) => c.headers,
    fetch: async (url) => {
      asked.push(url);
      const ok = /h264_(1080_best|720)\/media-vid|aac_cha2/.test(url);
      return { status: ok ? 200 : 404, text: async () => '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10.0,\n1.m4s\n#EXTINF:5.0,\n2.m4s' };
    },
  };
  const result = await frameio.resolve([{ url: seg, headers: { userAgent: 'UA', referer: 'https://next.frame.io/' } }], ctx);
  assert.deepStrictEqual(result.variants.map((v) => v.id), ['h264_1080_best', 'h264_720']);
  assert.strictEqual(result.variants[0].height, 1080);
  assert.ok(result.video.url.endsWith('/h264_1080_best/media-vid.m3u8'));
  assert.ok(result.audio.url.endsWith('/aac_cha2/media-aud.m3u8'));
  assert.strictEqual(result.pageTitle, '26-27 SEA Open');
  assert.strictEqual(result.durationSec, 15);
  assert.ok(asked[0].startsWith('https://sahls.frame.io/encode-hls/abc123/token/eyJhbGciOi.eyJzdWIi.sig/h264_2160/'));
  console.log('sniff ok');
})();
