import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestHandler } from '../src/handler.js';
import { createElasticsearchClient } from '../src/elastic-search-client.js';
import { projectH5Analysis } from '../src/elk-dashboard.js';

const at = Date.parse('2026-10-20T07:38:43.559Z');
const load = { MOD: 'h5PageAnalysis', EV: 'xsm.H5PageLoad', eventType: 'page_load',
  eventId: 'load-1', timestamp: String(at), route: '/bx-app-h5/learningIndex?token=hidden',
  contextId: 'A'.repeat(32), sessionId: 'session-1', totalMs: '1302', dnsMs: '0',
  ttfbMs: '78', domReadyMs: '1280', fpMs: '200', fcpMs: '420', ttiMs: '442' };
const error = { MOD: 'h5PageAnalysis', EV: 'xsm.H5PageError', eventType: 'page_error',
  eventId: 'error-1', timestamp: String(at + 300),
  appVersion: '5.29.2', h5Release: 'h5-2026.10',
  DTL: JSON.stringify({ route: '/bx-app-h5/learningIndex', errorType: 'js_exception', message: 'Error: failed',
    reasonCode: 'uncaught_exception', stage: 'after_load', resourceType: 'script', httpStatus: 404,
    sourceFile: 'https://example.com/assets/app.js', line: 42, column: 7,
    stack: 'https://example.com/assets/app.js:42:7', codeSnippet: 'throw new Error("failed")',
    contextId: 'A'.repeat(32) }) };
const api = { MOD: 'h5PageAnalysis', EV: 'xsm.H5ApiRequest', eventType: 'apm_api',
  eventId: 'api-1', timestamp: String(at + 400), route: '/bx-app-h5/learningIndex',
  DTL: JSON.stringify({ apiHost: 'api.example.com', apiPath: '/v1/lessons', httpStatus: 200,
    durationMs: 120, contextId: 'A'.repeat(32) }) };
const pageLoadFcp = { MOD: 'h5PageAnalysis', EV: 'xsm.H5PageLoad', eventType: 'apm_perf_fcp',
  eventId: 'page-load-fcp-1', timestamp: String(at + 500), route: '/bx-app-h5/learningIndex', fcpMs: '420' };
const native = { MOD: 'h5PageAnalysis', EV: 'xsm.H5NativeContext', eventType: 'native_context',
  eventId: 'native-1', timestamp: String(at - 5000), contextId: 'A'.repeat(32),
  deviceModel: 'iPhone11,8', networkType: 'wifi', appVersion: '0.9.0', trigger: 'reporter_start',
  residentMemoryBytes: '1048576' };

test('projects ELK fields without interpreting missing timing as zero or exposing URL queries', () => {
  const record = projectH5Analysis(load);
  assert.equal(record.parsed.logs[0].common.page, '/bx-app-h5/learningIndex');
  assert.equal(record.parsed.logs[1].log.total, 1302);
  assert.equal(record.parsed.logs[1].log.dns, 0);
  assert.equal(record.parsed.logs[1].log.ready, 1280);
  assert.equal(record.parsed.logs[1].log.fpt, 200);
  assert.equal(record.parsed.logs[1].log.fcp, 420);
  assert.equal(record.parsed.logs[1].log.tti, 442);
  assert.equal(record.parsed.header.uid, 'A'.repeat(32));
  assert.equal(record.parsed.logs[1].log.tcp, undefined);
  const projectedError = projectH5Analysis(error).parsed.logs[0].log;
  assert.equal(projectH5Analysis(error).parsed.logs[0].common.appVersion, '5.29.2');
  assert.equal(projectH5Analysis({ ...error, appVersion: undefined, AV: '1.1.7' }).parsed.logs[0].common.appVersion, '1.1.7');
  assert.equal(projectH5Analysis({ ...error, AV: '1.1.7' }).parsed.logs[0].common.appVersion, '5.29.2');
  assert.equal(projectH5Analysis(error).parsed.logs[0].common.release, undefined);
  assert.equal(projectedError.stage, 'after_load');
  assert.equal(projectedError.reasonCode, 'uncaught_exception');
  assert.equal(projectedError.resourceType, 'script');
  assert.equal(projectedError.httpStatus, 404);
  assert.equal(projectedError.file, 'https://example.com/assets/app.js');
  assert.equal(projectedError.line, 42);
  assert.equal(projectedError.col, 7);
  assert.equal(projectedError.stack, 'https://example.com/assets/app.js:42:7');
  assert.equal(projectedError.codeSnippet, undefined);
  assert.equal(projectH5Analysis({ ...error, DTL: JSON.stringify({ ...JSON.parse(error.DTL),
    sourceFile: 'https://example.com/a.js?token=private#hash',
    stack: 'at fn (https://example.com/a.js?token=private:1:2)' }) }).parsed.logs[0].log.stack, undefined);
  assert.equal(projectH5Analysis({ ...load, EV: 'xsm.H5PageAnalysis' }), null);
  assert.equal(projectH5Analysis({ ...load, EV: 'xsm.H5PageAnalysis', eventType: 'apm_raw' }), null);
  assert.equal(projectH5Analysis({ ...load, EV: 'xsm.H5PageError' }), null);
  assert.equal(projectH5Analysis({ ...error, EV: 'xsm.H5PageAnalysis', eventType: undefined,
    DTL: JSON.stringify({ eventType: 'page_error', route: '/bx-app-h5/learningIndex', message: 'Error: failed' }) }), null);
  assert.equal(projectH5Analysis({ ...api, EV: 'xsm.H5PageLoad' }), null);
  assert.equal(projectH5Analysis({ ...native, contextId: '' }), null);
  assert.equal(projectH5Analysis({ ...pageLoadFcp, fcpMs: '' }), null);
  assert.deepEqual(projectH5Analysis(pageLoadFcp).parsed.logs.map(({ type }) => type), ['perf_fcp']);
});

test('ELK dashboard aggregates independent EVs, joins native snapshots and never reads local archives', async () => {
  const calls = [];
  const navigationId = 'B'.repeat(32);
  const elkClient = { indexPattern: 'log-fe-*-gsl_test',
    async scanWindow(options) { calls.push(options); return [{ ...load, navigationId }, { ...load, navigationId }, error, api, api,
      { ...pageLoadFcp, navigationId }, native,
      { ...load, EV: 'xsm.H5PageAnalysis', eventId: 'ignored-legacy' }]; }, logError() {} };
  const { handle, store } = createRequestHandler({ dataDir: '/tmp/elk-dashboard-fixture',
    elkClient, dashboardSource: 'elk', quiet: true });
  try {
    const response = await handle({ method: 'GET', url: '/__sink/api/dashboard?date=2026-10-20' });
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body);
    assert.equal(data.storage.source, 'elk');
    assert.equal(data.overview.pageViews, 1);
    assert.equal(data.overview.errors, 1);
    assert.equal(data.errors[0].file, 'https://example.com/assets/app.js');
    assert.equal(data.errors[0].line, 42);
    assert.equal(data.errors[0].column, 7);
    assert.equal(data.errors[0].codeSnippet, null);
    assert.equal(data.errors[0].version, '5.29.2');
    assert.equal(data.overview.sessions, 1);
    assert.equal(data.overview.uniqueVisitors, 1);
    assert.equal(data.overview.apiRequests, 1);
    assert.equal(data.overview.apiSuccessRate, 100);
    assert.equal(data.overview.averageApiRtMs, 120);
    assert.equal(data.native.contexts, 1);
    assert.equal(data.native.matchedPageViews, 1);
    assert.equal(data.native.latestResidentMemoryBytes, 1048576);
    assert.equal(data.apis[0].api, 'https://api.example.com/v1/lessons');
    assert.equal(data.performance.fcp.count, 1);
    assert.equal(data.performance.fcp.p50, 420);
    assert.equal(data.userPerception.metrics.fp.p50, 200);
    assert.equal(data.userPerception.metrics.fcp.p50, 420);
    assert.equal(data.userPerception.metrics.tti.p50, 442);
    assert.equal(data.performance.pageLoad.p50, 1302);
    assert.equal(data.loadingPerformance.stages.dns.count, 1);
    assert.equal(data.loadingPerformance.stages.ready.count, 1);
    assert.equal(data.loadingPerformance.stages.tcp.count, 0);
    assert.equal(data.pages[0].page, '/bx-app-h5/learningIndex');
    assert.equal(data.errors[0].message, 'Error: failed');
    assert.equal(data.errors[0].at, new Date(at + 300).toISOString());
    assert.equal(data.errors[0].httpStatus, 404);
    assert.equal(data.errorAnalysis.affectedVisitors, 1);
    assert.equal(data.errorAnalysis.types[0].value, 'js_exception');
    assert.equal(data.errorAnalysis.reasons[0].value, 'uncaught_exception');
    assert.equal(data.errorAnalysis.stages[0].value, 'after_load');
    assert.equal(data.errorAnalysis.issues[0].firstVersion, '5.29.2');
    assert.equal(data.errorAnalysis.issues[0].lastVersion, '5.29.2');
    assert.equal(calls[0].mod, 'h5PageAnalysis');
    assert.deepEqual(calls[0].evs, ['xsm.H5PageLoad', 'xsm.H5PageError', 'xsm.H5ApiRequest',
      'xsm.H5NativeContext']);
  } finally { await store.close(); }
});

test('ELK dashboard switches only between the fixed test and online clients', async () => {
  const calls = { test: 0, online: 0 };
  const makeClient = (environment, indexPattern, message) => ({
    indexPattern,
    async scanWindow() {
      calls[environment] += 1;
      return [{ ...load, eventId: `${environment}-load`, message }];
    },
    async listApps() { return ['学什么']; },
  });
  const { handle, store } = createRequestHandler({
    dataDir: '/tmp/elk-dashboard-environments', dashboardSource: 'elk', quiet: true,
    elkClients: {
      test: makeClient('test', 'log-fe-*-gsl_test', 'test data'),
      online: makeClient('online', 'log-fe*gsl_fe_v2*', 'online data'),
    },
  });
  const post = (fields) => handle({ method: 'POST', url: '/__sink/api/dashboard',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ date: '2026-10-20', ...fields }).toString() });
  try {
    const defaultData = JSON.parse((await post({})).body);
    assert.equal(defaultData.storage.environment, 'test');
    assert.equal(defaultData.storage.indexPattern, 'log-fe-*-gsl_test');

    const onlineResponse = await post({ elkEnvironment: 'online' });
    assert.equal(onlineResponse.status, 200);
    const onlineData = JSON.parse(onlineResponse.body);
    assert.equal(onlineData.storage.environment, 'online');
    assert.equal(onlineData.storage.indexPattern, 'log-fe*gsl_fe_v2*');
    assert.equal(calls.test, 1);
    assert.equal(calls.online, 1);

    const invalid = await post({ elkEnvironment: 'other' });
    assert.equal(invalid.status, 400);
  } finally { await store.close(); }
});

test('online ELK selection reports a missing online reader instead of falling back to test', async () => {
  const testClient = { indexPattern: 'log-fe-*-gsl_test', async scanWindow() { return []; } };
  const { handle, store } = createRequestHandler({ dataDir: '/tmp/elk-dashboard-no-online',
    elkClient: testClient, dashboardSource: 'elk', quiet: true });
  try {
    const response = await handle({ method: 'GET', url: '/__sink/api/dashboard?date=2026-10-20&elkEnvironment=online' });
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).environment, 'online');
  } finally { await store.close(); }
});

test('page-load FCP with the same validated navigation ID does not double-count page_load FCP', async () => {
  const navigationId = 'B'.repeat(32);
  const elkClient = { indexPattern: 'log-fe-*-gsl_test', async scanWindow() { return [
    { ...load, navigationId, fcpMs: '375' },
    { ...pageLoadFcp, navigationId, fcpMs: '375' },
    { ...pageLoadFcp, eventId: 'other-page-load-fcp', navigationId: 'C'.repeat(32), fcpMs: '460' },
  ]; } };
  const { handle, store } = createRequestHandler({ dataDir: '/tmp/elk-dashboard-paint',
    elkClient, dashboardSource: 'elk', quiet: true });
  try {
    const response = await handle({ method: 'GET', url: '/__sink/api/dashboard?date=2026-10-20' });
    const data = JSON.parse(response.body);
    assert.equal(data.performance.fcp.count, 2);
    assert.equal(data.overview.pageViews, 1);
  } finally { await store.close(); }
});

test('dashboard filters ELK data by log dimensions across views and keeps identities out of options', async () => {
  const calls = [];
  const taggedLoad = { ...load, AN: '学什么', AV: '1.1.7', OT: 'iOS', OV: '13.6',
    UNAME: '测试用户', PHONE: '13800000000' };
  const taggedError = { ...error, AN: '学什么', AV: '1.1.7', OT: 'iOS', OV: '13.6',
    UNAME: '测试用户', PHONE: '13800000000' };
  const anotherApp = { ...taggedLoad, AN: '另一应用', eventId: 'other-app-load' };
  const client = { indexPattern: 'log-fe-*-gsl_test',
    async scanWindow(options) {
      calls.push(options);
      return [taggedLoad, taggedError, anotherApp].filter((record) => record.AN === options.an);
    },
    async listApps() { return ['学什么', '另一应用']; } };
  const { handle, store } = createRequestHandler({ dataDir: '/tmp/elk-dashboard-log-filters',
    elkClient: client, dashboardSource: 'elk', quiet: true });
  const post = (fields) => handle({ method: 'POST', url: '/__sink/api/dashboard',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ date: '2026-10-20', ...fields }).toString() });
  try {
    const defaultResponse = await post({});
    assert.equal(defaultResponse.status, 200);
    const defaultView = JSON.parse(defaultResponse.body);
    assert.equal(calls[0].an, '学什么');
    assert.equal(defaultView.storage.indexPattern, 'log-fe-*-gsl_test');
    assert.equal(defaultView.userPerception.activeFilters.AN, '学什么');
    assert.deepEqual(defaultView.userPerception.filterOptions.AN, ['另一应用', '学什么']);
    assert.deepEqual(defaultView.userPerception.filterOptions.AV, ['1.1.7']);
    assert.deepEqual(defaultView.userPerception.filterOptions.OT, ['iOS']);
    assert.deepEqual(defaultView.userPerception.filterOptions.OV, ['13.6']);
    assert.deepEqual(defaultView.userPerception.filterOptions.EV, ['xsm.H5PageError', 'xsm.H5PageLoad']);
    assert.deepEqual(defaultView.userPerception.filterOptions.UNAME, []);
    assert.deepEqual(defaultView.userPerception.filterOptions.PHONE, []);
    assert.equal(defaultView.overview.errors, 1);
    assert.equal(defaultView.overview.pageViews, 1);

    const matching = JSON.parse((await post({ 'dim.AN': '学什么', 'dim.AV': '1.1.7',
      'dim.OT': 'iOS', 'dim.OV': '13.6', 'dim.UNAME': '测试用户',
      'dim.PHONE': '13800000000', 'dim.EV': 'xsm.H5PageError' })).body);
    assert.equal(matching.overview.errors, 1);
    assert.equal(matching.overview.pageViews, 0);
    assert.equal(matching.userPerception.activeFilters.PHONE, '13800000000');
    const absent = JSON.parse((await post({ 'dim.UNAME': '其他用户' })).body);
    assert.equal(absent.overview.errors, 0);
    assert.equal(absent.overview.pageViews, 0);
    const other = JSON.parse((await post({ 'dim.AN': '另一应用' })).body);
    assert.equal(calls.at(-1).an, '另一应用');
    assert.equal(other.overview.pageViews, 1);
    assert.equal(other.overview.errors, 0);
    assert.equal((await post({ 'dim.PHONE': '' })).status, 400);
    assert.equal((await post({ 'dim.unknown': 'x' })).status, 400);
    assert.equal((await handle({ method: 'POST', url: '/__sink/api/dashboard', body: '' })).status, 415);
    assert.equal((await handle({ method: 'GET', url: '/__sink/api/dashboard?date=2026-10-20' })).status, 200);
  } finally { await store.close(); }
});

test('existing official APM performance copy is accepted as xsm.H5PageLoad', () => {
  const record = projectH5Analysis({ ...load, EV: 'xsm.H5PageLoad', eventType: 'apm_perf' });
  assert.deepEqual(record.parsed.logs.map(({ type }) => type), ['perf']);
  assert.equal(record.parsed.logs[0].log.fpt, 200);
  assert.equal(record.parsed.logs[0].log.fcp, 420);
  assert.equal(record.parsed.logs[0].log.tti, 442);
});

test('ELK dashboard fails closed when unconfigured or incomplete', async () => {
  const offline = createRequestHandler({ dataDir: '/tmp/elk-dashboard-offline', dashboardSource: 'elk', quiet: true });
  try { assert.equal((await offline.handle({ method: 'GET', url: '/__sink/api/dashboard' })).status, 503); }
  finally { await offline.store.close(); }
  const broken = createRequestHandler({ dataDir: '/tmp/elk-dashboard-broken', dashboardSource: 'elk', quiet: true,
    elkClient: { async scanWindow() { throw new Error('ELK_TOO_MANY_RECORDS'); } } });
  try { assert.equal((await broken.handle({ method: 'GET', url: '/__sink/api/dashboard?date=2026-10-20' })).status, 502); }
  finally { await broken.store.close(); }
});

test('ELK reader splits large time windows without truncating records', async () => {
  const requests = [];
  const client = createElasticsearchClient({ baseUrl: 'https://es.invalid', indexPattern: 'log-fe-*-gsl_test',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const start = Date.parse(body.query.bool.filter[0].range.timestamp.gte);
      const end = Date.parse(body.query.bool.filter[0].range.timestamp.lt);
      const hits = end - start > 500 ? Array.from({ length: 1000 }, () => ({ _source: load })) : [{ _source: load }];
      const total = end - start > 500 ? 1001 : 1;
      return { ok: true, async text() { return JSON.stringify({ hits: { total: { value: total, relation: 'eq' }, hits } }); } };
    } });
  const records = await client.scanWindow({ from: new Date(0).toISOString(), to: new Date(1000).toISOString(),
    an: '学什么', mod: 'h5PageAnalysis', evs: ['xsm.H5PageLoad', 'xsm.H5PageError'] });
  assert.equal(records.length, 2);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].query.bool.filter[1].match_phrase.AN, '学什么');
  assert.equal(requests[0]._source.includes('PHONE'), true);
});
