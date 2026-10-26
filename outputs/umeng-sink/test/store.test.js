import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { SinkStore, dayStamp, truncateBase64 } from '../src/store.js';

async function withStore(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'umeng-sink-store-'));
  const store = new SinkStore({ dataDir });
  try {
    return await run({ store, dataDir });
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

function lines(text) {
  return text.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}

test('channels interleaving on the same day do not close each other', async () => {
  await withStore(async ({ store, dataDir }) => {
    store.write('h5-beacon', { n: 1 });
    store.write('h5-image-ping', { n: 2 });
    store.write('h5-beacon', { n: 3 });
    store.write('ios-analytics', { n: 4 });
    store.write('h5-beacon', { n: 5 });
    await store.flush();

    const day = dayStamp();
    assert.deepEqual((await lines(await readFile(join(dataDir, `h5-beacon-${day}.ndjson`), 'utf8'))).map((e) => e.n), [1, 3, 5]);
    assert.deepEqual((await lines(await readFile(join(dataDir, `h5-image-ping-${day}.ndjson`), 'utf8'))).map((e) => e.n), [2]);
    assert.deepEqual((await lines(await readFile(join(dataDir, `ios-analytics-${day}.ndjson`), 'utf8'))).map((e) => e.n), [4]);
  });
});

test('records carry the received time, channel and truncation-marked raw bytes', async () => {
  await withStore(async ({ store, dataDir }) => {
    store.write('h5-logs', { parsed: { logCount: 1 } }, Buffer.alloc(16, 7));
    await store.flush();

    const [event] = lines(await readFile(join(dataDir, `h5-logs-${dayStamp()}.ndjson`), 'utf8'));
    assert.equal(event.channel, 'h5-logs');
    assert.equal(event.parsed.logCount, 1);
    assert.equal(event.rawBody.encoding, 'base64');
    assert.equal(event.rawBody.bytes, 16);
    assert.equal(event.rawBody.truncated, false);
    assert.match(event.receivedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('the debug ring is bounded and keeps the newest events', () => {
  const store = new SinkStore({ dataDir: '/tmp/umeng-sink-ring-test', ringSize: 3 });
  for (let index = 0; index < 5; index += 1) store.write('test', { index });
  assert.deepEqual(store.recent().map((event) => event.index), [4, 3, 2]);
  assert.deepEqual(store.recent({ limit: 2 }).map((event) => event.index), [4, 3]);
  assert.equal(store.stats().channels[0].count, 5);
  return store.close().then(() => rm('/tmp/umeng-sink-ring-test', { recursive: true, force: true }));
});

test('raw bodies above the retention cap are marked truncated', () => {
  const clipped = truncateBase64(Buffer.alloc(10, 1), 4);
  assert.equal(clipped.bytes, 10);
  assert.equal(clipped.truncated, true);
  assert.equal(Buffer.from(clipped.data, 'base64').length, 4);
  assert.equal(truncateBase64(null), null);
});

test('writes after close are refused instead of silently lost', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'umeng-sink-closed-'));
  const store = new SinkStore({ dataDir });
  await store.close();
  assert.throws(() => store.write('ios-analytics', {}), /closed/);
  await rm(dataDir, { recursive: true, force: true });
});
