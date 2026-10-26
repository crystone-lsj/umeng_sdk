import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElkSearchBody, createElasticsearchClient, projectElkSource } from '../src/elastic-search-client.js';
import { createRequestHandler } from '../src/handler.js';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(payload); } };
}

test('builds a bounded read-only search over the configured index pattern', () => {
  const body = buildElkSearchBody({ from: '2026-10-19T02:08:56.188Z', to: '2026-10-19T03:08:56.188Z', an: '学什么', ev: 'networkAbsoluteRequestSuccess', limit: 5000 });
  assert.equal(body.size, 1000);
  assert.deepEqual(body.sort[0], { timestamp: { order: 'desc', unmapped_type: 'date' } });
  assert.equal(body.query.bool.filter.length, 3);
  assert.deepEqual(body.query.bool.filter[1], { match_phrase: { AN: '学什么' } });
});

test('uses server-side auth and does not expose it in diagnostics', async () => {
  const calls = [];
  const client = createElasticsearchClient({
    baseUrl: 'https://es.example.test', indexPattern: 'log-fe*gsl_fe_v2*', username: 'kibana_reader', password: 'secret',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response({ took: 2, hits: { total: { value: 0 }, hits: [] } }); },
  });
  await client.status();
  assert.match(calls[0].init.headers.authorization, /^Basic /);
  assert.equal(client.describe().indexPattern, 'log-fe*gsl_fe_v2*');
  assert.equal(JSON.stringify(client.describe()).includes('secret'), false);
});

test('projects ELK source fields and removes direct identifiers and URL queries', () => {
  const source = projectElkSource({ PHONE: 'secret', UNAME: 'secret', u_ip: 'secret', DI: 'secret', AN: '学什么', EV: 'h5Error', url: 'https://example.test/path?token=secret', DTL: 'x' });
  assert.deepEqual(source, { AN: '学什么', EV: 'h5Error', url: 'https://example.test/path', DTL: 'x' });
});

test('serves ELK status and bounded search through the receiver without exposing credentials', async () => {
  const elkClient = {
    indexPattern: 'log-fe*gsl_fe_v2*',
    describe: () => ({ configured: true, indexPattern: 'log-fe*gsl_fe_v2*', timeoutMs: 8000 }),
    async status() { return { ok: true, indexPattern: this.indexPattern, total: { value: 1 }, tookMs: 3 }; },
    async fieldCaps() { return { fields: { EV: { keyword: {} } } }; },
    async search() { return { took: 3, hits: { total: { value: 1 }, hits: [{ _id: '1', _index: 'log-fe-2026.10.19-gsl_fe_v2', sort: [1], _source: { AN: '学什么', EV: 'h5Error', PHONE: 'secret' } }] } }; },
    logError() {},
  };
  const { handle, store } = createRequestHandler({ dataDir: '/tmp/umeng-elk-client-test', elkClient, quiet: true });
  try {
    const status = await handle({ method: 'GET', url: '/__sink/api/elk/status' });
    assert.equal(status.status, 200);
    const search = await handle({ method: 'GET', url: '/__sink/api/elk/search?AN=%E5%AD%A6%E4%BB%80%E4%B9%88&limit=20' });
    assert.equal(search.status, 200);
    const body = JSON.parse(search.body);
    assert.equal(body.total, 1);
    assert.equal(body.hits[0].source.PHONE, undefined);
    assert.equal(body.hits[0].source.AN, '学什么');
  } finally { await store.close(); }
});
