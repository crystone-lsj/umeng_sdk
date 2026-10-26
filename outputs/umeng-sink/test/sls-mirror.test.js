import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createRequestHandler } from '../src/handler.js';
import { dashboardProjection } from '../src/sls-mirror.js';

function mockClient() {
  const records = [];
  return {
    records,
    async put(row) { records.push(row); },
    async readDay(channel, date) {
      return { complete: true, events: records.filter((row) => row.channel === channel && row.receivedAt.slice(0, 10) === date) };
    },
  };
}
function performance(at, suffix = 'first') {
  return { schema: 'h5-navigation-v1', clientAt: at, parsed: {
    header: { pid: 'project', sid: 'session', uid: 'visitor' },
    logs: [{ type: 'perf', common: { page: `https://site.test/${suffix}?secret=NO`, ctime: String(at) },
      log: { total: 1200, fcp: 430 } }], logCount: 1,
  } };
}
async function dashboard(handle, query = '') {
  const response = await handle({ method: 'GET', url: `/__sink/api/dashboard${query}` });
  assert.equal(response.status, 200);
  return JSON.parse(response.body.toString());
}
async function fixture(run) {
  const dataDir = await mkdtemp(join(tmpdir(), 'umeng-sls-'));
  const client = mockClient();
  const { handle, store, mirror } = createRequestHandler({ dataDir, slsClient: client, quiet: true });
  try { await run({ dataDir, client, handle, store, mirror }); }
  finally { await store.close(); await mirror.flush(); await rm(dataDir, { recursive: true, force: true }); }
}

test('local success mirrors only allowlisted dashboard facts; complete SLS is queried', async () => fixture(async ({ client, handle, store, mirror }) => {
  const now = Date.now();
  store.write('h5-navigation', performance(now), Buffer.from('accessToken=NO'));
  store.write('ios-config', { query: { token: 'NO' } }, Buffer.from('secret'));
  await store.flush(); await mirror.flush();
  assert.equal(client.records.length, 2);
  assert.equal(client.records.find((row) => row.channel === 'h5-navigation').parsed.logs[0].common.page.includes('?'), false);
  assert.equal(JSON.stringify(client.records).includes('NO'), false);
  const result = await dashboard(handle);
  assert.equal(result.storage.source, 'sls');
  assert.equal(result.slowLoading.overview.samples, 1);
  assert.equal(result.overview.pageViews, 0);
  assert.equal(result.userPerception.metrics.fcp.count, 1);
}));

test('write failure never fails client or local dashboard', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'umeng-sls-fail-'));
  const { handle, store, mirror } = createRequestHandler({ dataDir, quiet: true, slsClient: {
    async put() { throw new Error('offline'); },
    async readDay() { throw new Error('offline'); },
  } });
  try {
    store.write('h5-navigation', performance(Date.now()));
    await store.flush(); await mirror.flush();
    const result = await dashboard(handle);
    assert.equal(result.storage.source, 'local');
    assert.equal(result.slowLoading.overview.samples, 1);
    assert.equal(mirror.stats.failed, 1);
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('truncated SLS pages and id mismatches fall back for entire dashboard', async () => fixture(async ({ client, handle, store, mirror }) => {
  store.write('h5-navigation', performance(Date.now()));
  await store.flush(); await mirror.flush();
  client.readDay = async () => ({ events: client.records, complete: false });
  assert.equal((await dashboard(handle)).storage.source, 'local');
  client.readDay = async () => ({ events: [{ ...client.records[0], mirrorId: 'wrong' }], complete: true });
  assert.equal((await dashboard(handle)).storage.source, 'local');
}));

test('historical unmirrored archive and previous window are never silently mixed into SLS', async () => fixture(async ({ client, handle, store, mirror, dataDir }) => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await writeFile(join(dataDir, `h5-navigation-${yesterday}.ndjson`),
    `${JSON.stringify({ receivedAt: `${yesterday}T10:00:00.000Z`, channel: 'h5-navigation', ...performance(Date.parse(`${yesterday}T10:00:00.000Z`)) })}\n`);
  store.write('h5-navigation', performance(Date.now()));
  await store.flush(); await mirror.flush();
  const end = new Date(Date.now() + 1000).toISOString();
  const from = new Date(Date.now() - 86400000).toISOString();
  const result = await dashboard(handle, `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(end)}`);
  assert.equal(result.storage.source, 'local');
  assert.equal(result.slowLoading.overview.samples >= 1, true);
  assert.equal(client.records.length, 1);
}));

test('projection strips secret fields without inventing missing identity or performance', () => {
  const projection = dashboardProjection({ channel: 'h5-navigation', receivedAt: '2026-10-16T00:00:00Z',
    headers: { Authorization: 'secret' }, contextId: undefined,
    parsed: { header: {}, logs: [{ type: 'perf', common: { page: 'https://x.test/p?token=secret' }, log: { total: 500, stack: 'secret' } }] } });
  assert.equal(projection.contextId, undefined);
  assert.equal(projection.parsed.logs[0].log.total, 500);
  assert.equal(projection.parsed.logs[0].log.fcp, undefined);
  assert.equal(JSON.stringify(projection).includes('secret'), false);
});

test('read timeout falls back locally and does not expose provider error details', async () => fixture(async ({ handle, store, mirror, client }) => {
  store.write('h5-navigation', performance(Date.now()));
  await store.flush(); await mirror.flush();
  mirror.timeoutMs = 15;
  client.readDay = () => new Promise(() => {});
  const result = await dashboard(handle);
  assert.equal(result.storage.source, 'local');
  assert.equal(result.storage.reason, 'SLS read timeout');
  client.readDay = () => { throw new Error('secret-access-key'); };
  assert.equal((await dashboard(handle)).storage.reason, 'SLS query unavailable');
}));

test('write timeout bounds pending mirror tasks and leaves local records available', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'umeng-sls-timeout-'));
  const { handle, store, mirror } = createRequestHandler({ dataDir, quiet: true, slsTimeoutMs: 15, slsClient: {
    put: () => new Promise(() => {}),
    readDay: () => new Promise(() => {}),
  } });
  try {
    store.write('h5-navigation', performance(Date.now()));
    await store.flush(); await mirror.flush();
    assert.equal(mirror.stats.pending, 0);
    assert.equal(mirror.stats.failed, 1);
    assert.equal((await dashboard(handle)).storage.source, 'local');
  } finally { await store.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('previous-period metrics use the same complete SLS source', async () => fixture(async ({ client, handle, store, mirror, dataDir }) => {
  const now = Date.now();
  const priorAt = now - 36 * 3600000;
  const day = new Date(priorAt).toISOString().slice(0, 10);
  const previousRow = { channel: 'h5-navigation', receivedAt: new Date(priorAt).toISOString(),
    mirrorId: 'old-id', ...performance(priorAt) };
  await writeFile(join(dataDir, `h5-navigation-${day}.ndjson`), `${JSON.stringify(previousRow)}\n`);
  client.records.push(dashboardProjection(previousRow));
  store.write('h5-navigation', performance(now));
  await store.flush(); await mirror.flush();
  const result = await dashboard(handle, `?from=${encodeURIComponent(new Date(now - 24 * 3600000).toISOString())}&to=${encodeURIComponent(new Date(now + 1000).toISOString())}`);
  assert.equal(result.storage.source, 'sls');
  assert.equal(result.userPerception.previous.metrics.fcp.count, 1);
}));
