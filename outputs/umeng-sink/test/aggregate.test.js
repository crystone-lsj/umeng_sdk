import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { aggregateDashboard, isValidDate } from '../src/aggregate.js';

function record(channel, receivedAt, logs, header = { pid: 'pid', sid: 'session-1', uid: 'user-1' }) {
  return JSON.stringify({
    receivedAt,
    channel,
    parsed: { header, logs, logCount: logs.length },
  });
}

test('aggregates H5 pages, APIs, errors, visitors and performance by archive day', async () => {
  const dataDir = await mkdtemp();
  try {
    await mkdir(dataDir, { recursive: true });
    const logs = [
      { type: 'pv', schema: 'v1', common: { page: 'https://h5.example.com/home?from=push', uid: 'user-1' }, log: {} },
      { type: 'api', schema: 'v1', common: { page: 'https://h5.example.com/home?from=push' }, log: { url: 'https://api.example.com/list?x=1', rc: '200', rt: '120' } },
      { type: 'api', schema: 'v1', common: { page: 'https://h5.example.com/home?from=push' }, log: { url: 'https://api.example.com/list?x=2', rc: '500', rt: '300' } },
      { type: 'error', schema: 'v1', common: { page: 'https://h5.example.com/home?from=push', ctime: '1767271200000' }, log: { name: 'TypeError', msg: 'boom', stack: 'at home.js:1:2', file: 'home.js', line: '1', col: '2' } },
      { type: 'perf_fcp', schema: 'v1', common: { page: 'https://h5.example.com/home' }, log: { fcp: '800' } },
      { type: 'perf_fid', schema: 'v1', common: { page: 'https://h5.example.com/home' }, log: { fid: '90' } },
      { type: 'perf', schema: 'v1', common: { page: 'https://h5.example.com/home' }, log: { total: '1200' } },
    ];
    const beaconLogs = [
      { type: 'pv', schema: 'v2', common: { page: 'https://h5.example.com/course', pid: 'pid', sid: 'session-2', uid: 'user-2', ctime: '1767274800000' }, log: {} },
    ];
    await writeFile(join(dataDir, 'h5-logs-2026-01-01.ndjson'), [
      record('h5-logs', '2026-01-01T10:15:00.000Z', logs),
      '{malformed json\n',
      '\n',
    ].join('\n'));
    await writeFile(join(dataDir, 'h5-beacon-2026-01-01.ndjson'), `${record('h5-beacon', '2026-01-01T11:15:00.000Z', beaconLogs, { pid: 'pid' })}\n`);
    await writeFile(join(dataDir, 'h5-logs-2025-12-31.ndjson'), `${record('h5-logs', '2025-12-31T10:00:00.000Z', [{ type: 'pv', common: { page: '/old' }, log: {} }])}\n`);

    const result = await aggregateDashboard({ dataDir, date: '2026-01-01' });

    assert.equal(result.date, '2026-01-01');
    assert.deepEqual(result.availableDates, ['2025-12-31', '2026-01-01']);
    assert.equal(result.archive.records, 2);
    assert.equal(result.archive.malformedLines, 1);
    assert.equal(result.overview.pageViews, 2);
    assert.equal(result.overview.uniqueVisitors, 2);
    assert.equal(result.overview.sessions, 2);
    assert.equal(result.overview.errors, 1);
    assert.equal(result.overview.apiRequests, 2);
    assert.equal(result.overview.apiSuccessRate, 50);
    assert.deepEqual(result.overview.projectIds, ['pid']);
    assert.equal(result.trend[10].pageViews, 1);
    assert.equal(result.trend[11].pageViews, 1);

    const home = result.pages.find((page) => page.page === 'https://h5.example.com/home');
    assert.equal(home.pageViews, 1);
    assert.equal(home.uniqueVisitors, 1);
    assert.equal(home.errors, 1);
    assert.equal(home.apiSuccessRate, 50);
    assert.equal(home.averageDurationMs, 1200);

    assert.equal(result.apis.length, 1);
    assert.equal(result.apis[0].api, 'https://api.example.com/list');
    assert.equal(result.apis[0].requests, 2);
    assert.equal(result.apis[0].errors, 1);
    assert.equal(result.apis[0].averageRtMs, 210);
    assert.equal(result.performance.fcp.count, 1);
    assert.equal(result.performance.fcp.p75, 800);
    assert.equal(result.performance.fid.p90, 90);
    assert.equal(result.performance.pageLoad.p50, 1200);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].name, 'TypeError');
    assert.equal(result.errors[0].at, '2026-01-01T12:40:00.000Z');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('error distributions and latest details cover every error beyond the 200-row display limit', async () => {
  const dataDir = await mkdtemp();
  try {
    const logs = Array.from({ length: 205 }, (_, i) => ({ type: 'error',
      common: { page: i < 202 ? '/start' : '/end' },
      log: { name: i < 202 ? 'Error' : 'NetworkError', reasonCode: i < 202 ? null : 'http_failure',
        stage: 'after_load', httpStatus: i < 202 ? null : 503, msg: i < 202 ? 'same issue' : `failure ${i}` } }));
    await writeFile(join(dataDir, 'h5-logs-2026-10-20.ndjson'), [
      record('h5-logs', '2026-10-20T01:00:00.000Z', logs.slice(0, 202), { uid: 'visitor-1' }),
      record('h5-logs', '2026-10-20T02:00:00.000Z', logs.slice(202), { uid: 'visitor-2' }),
    ].join('\n'));
    const result = await aggregateDashboard({ dataDir, date: '2026-10-20' });
    assert.equal(result.overview.errors, 205);
    assert.equal(result.errors.length, 200);
    assert.equal(result.errors[0].at, '2026-10-20T02:00:00.000Z');
    assert.equal(result.errorAnalysis.latestAt, '2026-10-20T02:00:00.000Z');
    assert.equal(result.errorAnalysis.affectedVisitors, 2);
    assert.equal(result.errorAnalysis.pageCount, 2);
    assert.equal(result.errorAnalysis.issueCount, 4);
    assert.equal(result.errorAnalysis.issues[0].count, 202);
    assert.equal(result.errorAnalysis.issues[0].visitors, 1);
    assert.equal(result.errorAnalysis.types[0].count, 202);
    assert.equal(result.errorAnalysis.statuses.find((entry) => entry.value === '503').count, 3);
    assert.equal(result.errorAnalysis.statuses.find((entry) => entry.value === '未上报').count, 202);
    assert.equal(result.errorAnalysis.reasons.find((entry) => entry.value === '未上报').count, 202);
    assert.equal(result.errorAnalysis.reasons.find((entry) => entry.value === 'http_failure').count, 3);
    assert.equal(result.errorAnalysis.missingReasons, 202);
    assert.equal(result.errorAnalysis.pages.find((entry) => entry.value === '/end').count, 3);
    assert.equal(result.trend[2].errors, 3);
    assert.equal(result.trend[1].pageCount, 1);
    assert.equal(result.trend[2].pageCount, 1);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('error page trend deduplicates routes within each bucket and matches the overall page count', async () => {
  const dataDir = await mkdtemp();
  try {
    const error = (page, msg) => ({ type: 'error', common: { page }, log: { name: 'TypeError', msg } });
    await writeFile(join(dataDir, 'h5-logs-2026-10-20.ndjson'), [
      record('h5-logs', '2026-10-20T01:00:00.000Z', [
        error('/start?first=1', 'one'), error('/start?first=2', 'two'), error('/next', 'three'),
      ]),
      record('h5-logs', '2026-10-20T02:00:00.000Z', [error('/start', 'four'), error(undefined, 'five')]),
    ].join('\n'));

    const result = await aggregateDashboard({ dataDir, date: '2026-10-20' });
    assert.equal(result.errorAnalysis.pageCount, 3);
    assert.equal(result.trend[1].pageCount, 2);
    assert.equal(result.trend[2].pageCount, 2);
    assert.equal(result.trend[3].pageCount, 0);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('error list preserves first and latest versions and formats the versions seen for each issue', async () => {
  const dataDir = await mkdtemp();
  try {
    const issue = (ctime, release, uid) => ({
      type: 'error',
      common: { page: '/learning', ctime, ...(release ? { appVersion: release } : {}) },
      log: { name: 'TypeError', reasonCode: 'uncaught_exception', stage: 'after_load', msg: 'same failure' },
      uid,
    });
    const first = issue('1792458000000', '2.0.0', 'visitor-1');
    const second = issue('1792458060000', '1.5.0', 'visitor-2');
    const missing = issue('1792458120000', null, 'visitor-1');
    await writeFile(join(dataDir, 'h5-logs-2026-10-20.ndjson'), `${record('h5-logs', '2026-10-20T01:00:00.000Z', [first], { uid: 'visitor-1' })}\n${record('h5-logs', '2026-10-20T02:00:00.000Z', [second], { uid: 'visitor-2' })}\n${record('h5-logs', '2026-10-20T03:00:00.000Z', [missing], { uid: 'visitor-1' })}\n`);

    const result = await aggregateDashboard({ dataDir, date: '2026-10-20' });
    const row = result.errorAnalysis.issues.find((entry) => entry.message === 'same failure');
    assert.equal(row.count, 3);
    assert.equal(row.visitors, 2);
    assert.equal(row.lastAt, new Date(1792458120000).toISOString());
    assert.equal(row.lastVersion, '未上报');
    assert.equal(row.firstVersion, '2.0.0');
    assert.equal(row.versionRange, '1.5.0 ~ 2.0.0');
    assert.equal(result.errorAnalysis.versions.find((entry) => entry.value === '1.5.0').count, 1);
    assert.equal(result.errorAnalysis.versions.find((entry) => entry.value === '2.0.0').count, 1);
    assert.equal(result.errorAnalysis.versions.find((entry) => entry.value === '未上报').count, 1);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('error list ties first and latest versions to the corresponding event times', async () => {
  const dataDir = await mkdtemp();
  try {
    const issue = (ctime, release) => ({
      type: 'error',
      common: { page: '/learning', ctime, appVersion: release },
      log: { name: 'TypeError', reasonCode: 'uncaught_exception', msg: 'same failure' },
    });
    const late = issue('1792458120000', '3.0.0');
    const early = issue('1792458000000', '1.0.0');
    const middle = issue('1792458060000', '2.0.0');
    await writeFile(join(dataDir, 'h5-logs-2026-10-20.ndjson'), `${record('h5-logs', '2026-10-20T03:00:00.000Z', [late])}\n${record('h5-logs', '2026-10-20T01:00:00.000Z', [early])}\n${record('h5-logs', '2026-10-20T02:00:00.000Z', [middle])}\n`);

    const result = await aggregateDashboard({ dataDir, date: '2026-10-20' });
    const row = result.errorAnalysis.issues.find((entry) => entry.message === 'same failure');
    assert.equal(row.firstAt, new Date(1792458000000).toISOString());
    assert.equal(row.firstVersion, '1.0.0');
    assert.equal(row.lastAt, new Date(1792458120000).toISOString());
    assert.equal(row.lastVersion, '3.0.0');
    assert.equal(row.versionRange, '1.0.0 ~ 3.0.0');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('aggregates page-performance stages, perception ratios and slow-loading thresholds', async () => {
  const dataDir = await mkdtemp();
  try {
    const homePerf = {
      type: 'perf', schema: 'v1',
      common: { page: 'https://h5.example.com/home?x=1', sr: '390x844', release: '1.2.0', environment: 'prod' },
      log: {
        unload: '10', redirect: '20', appcache: '30', dns: '40', tcp: '50', ssl: '60', ttfb: '700',
        trans: '80', dom: '900', res: '100', firstbyte: '650', fpt: '500', fcp: '800', tti: '1100',
        ready: '1200', load: '1300', total: '1400',
      },
    };
    const coursePerf = {
      type: 'perf', schema: 'v2',
      common: { page: 'https://h5.example.com/course', sr: '414x896', release: '1.3.0', environment: 'prod' },
      log: {
        unload: '12', redirect: '22', appcache: '32', dns: '42', tcp: '52', ssl: '62', ttfb: '1700',
        trans: '82', dom: '1900', res: '102', firstbyte: '1650', fpt: '1500', fcp: '1800', tti: '2100',
        ready: '2200', load: '2300', total: '3600',
      },
    };
    await writeFile(join(dataDir, 'h5-beacon-2026-04-01.ndjson'), [
      JSON.stringify({ receivedAt: '2026-04-01T01:00:00.000Z', channel: 'h5-beacon', parsed: { header: { pid: 'pid', sid: 's1', uid: 'u1' }, logs: [homePerf, { type: 'perf_fcp', common: homePerf.common, log: { fcp: '900' } }], logCount: 2 } }),
      JSON.stringify({ receivedAt: '2026-04-01T02:00:00.000Z', channel: 'h5-beacon', parsed: { header: { pid: 'pid', sid: 's2', uid: 'u2' }, logs: [coursePerf], logCount: 1 } }),
    ].join('\n') + '\n');

    const result = await aggregateDashboard({ dataDir, date: '2026-04-01', slowThresholdMs: 3000 });

    assert.equal(result.userPerception.metrics.fp.p50, 500);
    assert.equal(result.userPerception.metrics.fcp.count, 3);
    assert.equal(result.userPerception.metrics.fcp.average, 1166.67);
    assert.deepEqual(result.userPerception.metricOrder.slice(0, 3), ['ttfb', 'tcp', 'tti']);
    assert.equal(result.userPerception.metrics.ttfb.p50, 700);
    assert.equal(result.userPerception.metrics.tcp.p50, 50);
    assert.equal(result.userPerception.metrics.tti.p50, 1100);
    assert.equal(result.userPerception.metrics.pageLoad.p50, 1400);
    assert.equal(result.userPerception.metrics.oneSecondFastRate.rate, 0);
    assert.equal(result.userPerception.metrics.twoSecondFastRate.rate, 50);
    assert.equal(result.userPerception.metrics.fiveSecondSlowRate.rate, 0);
    assert.deepEqual(result.userPerception.sampleDistribution, { good: 1, fair: 1, poor: 0 });
    assert.equal(result.userPerception.dimensions.screenSize[0].value, '390x844');

    const loadingHome = result.loadingPerformance.pages.find((page) => page.page === 'https://h5.example.com/home');
    assert.equal(loadingHome.sampleCount, 1);
    assert.equal(loadingHome.stages.ttfb.average, 700);
    const perceptionHome = result.userPerception.pages.find((page) => page.page === 'https://h5.example.com/home');
    assert.equal(perceptionHome.ttfb.average, 700);
    assert.equal(perceptionHome.tcp.average, 50);
    assert.equal(perceptionHome.pageLoad.average, 1400);
    assert.equal(loadingHome.stages.ready.average, 1200);
    assert.equal(loadingHome.stages.total.average, 1400);
    assert.equal(result.loadingPerformance.stages.total.count, 2);
    assert.equal(result.trend[1].metrics.total.p50, 1400);

    assert.equal(result.slowLoading.overview.samples, 2);
    assert.equal(result.slowLoading.overview.slowLoadingCount, 1);
    assert.equal(result.slowLoading.overview.slowLoadingRate, 50);
    assert.equal(result.slowLoading.overview.affectedPages, 1);
    assert.equal(result.slowLoading.overview.affectedVisitors, 1);
    assert.equal(result.slowLoading.pages[0].page, 'https://h5.example.com/course');
    assert.equal(result.slowLoading.pages[0].slowLoadingCount, 1);
    assert.equal(JSON.stringify(result.slowLoading.pages[0]).includes('openValues'), false);

    const stricter = await aggregateDashboard({ dataDir, date: '2026-04-01', slowThresholdMs: 1000 });
    assert.equal(stricter.slowLoading.overview.slowLoadingCount, 2);
    await assert.rejects(
      () => aggregateDashboard({ dataDir, date: '2026-04-01', slowThresholdMs: 20 }),
      (error) => error.code === 'INVALID_SLOW_THRESHOLD'
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('slow-loading timings use only matching slow samples and preserve missing stages', async () => {
  const dataDir = await mkdtemp();
  try {
    const page = 'https://h5.example.com/lesson?from=app';
    const logs = [
      { type: 'perf', common: { page }, log: { total: '800', firstbyte: '700', ready: '750' } },
      { type: 'perf', common: { page }, log: { total: '4000', firstbyte: '1200', ready: '2800' } },
      { type: 'perf', common: { page }, log: { total: '6000', ready: '3200' } },
      { type: 'perf', common: { page }, log: { load: '5200', firstbyte: '1800' } },
      { type: 'perf', common: { page: 'https://h5.example.com/other' }, log: { total: '900', firstbyte: '50' } },
    ];
    await writeFile(join(dataDir, 'h5-beacon-2026-04-02.ndjson'), record('h5-beacon', '2026-04-02T12:00:00.000Z', logs) + '\n');
    const result = await aggregateDashboard({ dataDir, date: '2026-04-02', slowThresholdMs: 3000 });
    const lesson = result.slowLoading.pages.find((row) => row.page === 'https://h5.example.com/lesson');
    assert.equal(lesson.sampleCount, 4);
    assert.equal(lesson.slowLoadingCount, 3);
    assert.equal(lesson.slowLoadingRate, 75);
    assert.equal(lesson.slowFirstbyteMs, 1500);
    assert.equal(lesson.slowReadyMs, 3000);
    assert.equal(lesson.slowTotalMs, 5000);
    assert.equal(result.slowLoading.overview.slowLoadingCount, 3);
    assert.equal(result.slowLoading.pages.find((row) => row.page === 'https://h5.example.com/other').slowFirstbyteMs, null);
    const defaultThreshold = await aggregateDashboard({ dataDir, date: '2026-04-02' });
    assert.equal(defaultThreshold.slowLoading.overview.slowLoadingCount, 2);
    assert.equal(defaultThreshold.slowLoading.pages.find((row) => row.page === 'https://h5.example.com/lesson').slowFirstbyteMs, 1800);
    const missing = await aggregateDashboard({ dataDir, date: '2026-04-02', slowThresholdMs: 5000 });
    const onlyMissing = missing.slowLoading.pages.find((row) => row.page === 'https://h5.example.com/lesson');
    assert.equal(onlyMissing.slowLoadingCount, 2);
    assert.equal(onlyMissing.slowFirstbyteMs, 1800);
    assert.equal(onlyMissing.slowReadyMs, 3200);
    assert.equal(onlyMissing.slowTotalMs, 6000);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('affected visitors include only identities attached to slow samples', async () => {
  const dataDir = await mkdtemp();
  try {
    const page = 'https://h5.example.com/lesson';
    const slow = { type: 'perf', common: { page }, log: { total: '6000' } };
    const fast = { type: 'perf', common: { page }, log: { total: '600' } };
    await writeFile(join(dataDir, 'h5-beacon-2026-04-03.ndjson'), [
      record('h5-beacon', '2026-04-03T10:00:00.000Z', [slow], { uid: 'slow-visitor' }),
      record('h5-beacon', '2026-04-03T10:01:00.000Z', [fast], { uid: 'fast-visitor' }),
      record('h5-beacon', '2026-04-03T10:02:00.000Z', [slow], { uid: 'slow-visitor' }),
    ].join('\n') + '\n');
    const result = await aggregateDashboard({ dataDir, date: '2026-04-03' });
    assert.equal(result.slowLoading.overview.slowLoadingCount, 2);
    assert.equal(result.slowLoading.overview.affectedVisitors, 1);
    assert.equal(result.slowLoading.pages[0].sampleCount, 3);
    assert.equal(JSON.stringify(result.slowLoading.pages).includes('slowVisitorIds'), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('dashboard aggregation defaults to the latest available archive day and validates input', async () => {
  const dataDir = await mkdtemp();
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'h5-beacon-2026-03-01.ndjson'), '\n');
    await writeFile(join(dataDir, 'h5-logs-2026-03-02.ndjson'), '\n');

    assert.equal((await aggregateDashboard({ dataDir })).date, '2026-03-02');
    await assert.rejects(() => aggregateDashboard({ dataDir, date: '../escape' }), /YYYY-MM-DD/);
    assert.equal(isValidDate('2026-02-29'), false);
    assert.equal(isValidDate('2028-02-29'), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function mkdtemp() {
  const { mkdtemp: make } = await import('node:fs/promises');
  return make(join(tmpdir(), 'umeng-sink-aggregate-'));
}

test('aggregates iOS context dimensions linked to H5 performance visitors', async () => {
  const dataDir = await mkdtemp();
  try {
    const context = {
      schema: 'ios-context-v1',
      projectId: 'gslearnwhat',
      contextId: 'context-0001',
      device: { model: 'iPhone', modelIdentifier: 'iPhone12,8', os: 'iOS', osVersion: '18.2' },
      app: { version: '1.2.3', build: '123' },
      network: { type: 'wifi', carrier: 'China Mobile' },
      region: { country: 'CN', timezone: 'Asia/Shanghai' },
    };
    await writeFile(join(dataDir, 'ios-context-2026-05-01.ndjson'), `${JSON.stringify({ channel: 'ios-context', context })}\n`);
    await writeFile(join(dataDir, 'h5-beacon-2026-05-01.ndjson'), `${JSON.stringify({
      receivedAt: '2026-05-01T01:00:00.000Z',
      channel: 'h5-beacon',
      parsed: {
        header: { pid: 'pid', sid: 's1', uid: context.contextId },
        logs: [{ type: 'perf', common: { page: 'https://h5.example.com/home', ct: '4g' }, log: { fcp: '800', total: '1400' } }],
        logCount: 1,
      },
    })}\n`);

    const result = await aggregateDashboard({ dataDir, date: '2026-05-01' });
    assert.deepEqual(result.userPerception.contextCoverage, {
      total: 1,
      exact: 1,
      singleContextFallback: 0,
      h5NetworkOnly: 0,
      none: 0,
      contexts: 1,
    });
    assert.deepEqual(result.userPerception.dimensions.deviceModel, [{ value: 'iPhone', count: 1, rate: 100 }]);
    assert.equal(result.userPerception.metricDimensions.deviceModel[0].fcp.average, 800);
    assert.equal(result.userPerception.metricDimensions.deviceModel[0].fp.count, 0);
    assert.equal(result.userPerception.metricDimensions.deviceModel[0].twoSecondFastRate.rate, 100);
    assert.deepEqual(result.userPerception.dimensions.osVersion, [{ value: 'iOS 18.2', count: 1, rate: 100 }]);
    assert.deepEqual(result.userPerception.dimensions.appVersion, [{ value: '1.2.3', count: 1, rate: 100 }]);
    assert.deepEqual(result.userPerception.dimensions.networkType, [{ value: 'wifi', count: 1, rate: 100 }]);
    assert.deepEqual(result.userPerception.dimensions.carrier, [{ value: 'China Mobile', count: 1, rate: 100 }]);
    assert.equal(result.userPerception.dimensions.region[0].value, 'CN / Asia/Shanghai');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('aggregates context fallback and H5-only network dimensions without inventing values', async () => {
  const dataDir = await mkdtemp();
  try {
    const context = {
      schema: 'ios-context-v1',
      contextId: 'context-0001',
      device: { model: 'iPad', os: 'iPadOS', osVersion: '18.1' },
      app: { version: '2.0.0' },
      network: { type: '5g', carrier: 'China Unicom' },
      region: { country: 'CN' },
    };
    await writeFile(join(dataDir, 'ios-context-2026-06-01.ndjson'), `${JSON.stringify({ context })}\n`);
    await writeFile(join(dataDir, 'h5-beacon-2026-06-01.ndjson'), [
      JSON.stringify({
        channel: 'h5-beacon',
        parsed: {
          header: { uid: 'visitor-fallback' },
          logs: [{ type: 'perf', common: { page: 'https://h5.example.com/fallback', ct: '4g' }, log: { fcp: '700', total: '1200' } }],
          logCount: 1,
        },
      }),
      JSON.stringify({
        channel: 'h5-beacon',
        parsed: {
          header: { uid: 'visitor-two' },
          logs: [{ type: 'perf', common: { page: 'https://h5.example.com/network-only', ct: '3g' }, log: { fcp: '900', total: '1600' } }],
          logCount: 1,
        },
      }),
    ].join('\n') + '\n');

    const result = await aggregateDashboard({ dataDir, date: '2026-06-01' });
    assert.deepEqual(result.userPerception.contextCoverage, {
      total: 2,
      exact: 0,
      singleContextFallback: 2,
      h5NetworkOnly: 0,
      none: 0,
      contexts: 1,
    });
    assert.deepEqual(result.userPerception.dimensions.deviceModel, [{ value: 'iPad', count: 2, rate: 100 }]);
    assert.deepEqual(result.userPerception.dimensions.networkType, [{ value: '5g', count: 2, rate: 100 }]);
    assert.deepEqual(result.userPerception.dimensions.carrier, [{ value: 'China Unicom', count: 2, rate: 100 }]);
    assert.deepEqual(result.userPerception.dimensions.region, [{ value: 'CN', count: 2, rate: 100 }]);
    assert.equal(result.archive.malformedLines, 0);

    await writeFile(join(dataDir, 'h5-beacon-2026-06-02.ndjson'), `${JSON.stringify({
      receivedAt: '2026-06-02T01:00:00.000Z',
      channel: 'h5-beacon',
      parsed: {
        header: { uid: 'visitor-network-only' },
        logs: [{ type: 'perf', common: { page: 'https://h5.example.com/network-only', ct: '3g' }, log: { fcp: '900', total: '1600' } }],
        logCount: 1,
      },
    })}\n`);
    const networkOnly = await aggregateDashboard({ dataDir, date: '2026-06-02' });
    assert.deepEqual(networkOnly.userPerception.contextCoverage, {
      total: 1,
      exact: 0,
      singleContextFallback: 0,
      h5NetworkOnly: 1,
      none: 0,
      contexts: 0,
    });
    assert.deepEqual(networkOnly.userPerception.dimensions.networkType, [{ value: '3g', count: 1, rate: 100 }]);
    assert.deepEqual(networkOnly.userPerception.dimensions.deviceModel, []);
    assert.deepEqual(networkOnly.userPerception.metricDimensions.deviceModel, []);
    assert.equal(networkOnly.userPerception.metricDimensions.networkType[0].fcp.average, 900);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('native snapshots are shown independently and repeated reports keep one H5 context identity', async () => {
  const dataDir = await mkdtemp();
  try {
    const context = {
      schema: 'ios-context-v1', contextId: 'AABBCCDDEEFF00112233445566778899', projectId: 'gslearnwhat',
      device: { model: 'iPhone', os: 'iOS', osVersion: '18.2' },
      app: { version: '1.2.3' }, network: { type: 'wifi' },
    };
    const snapshots = [
      { receivedAt: '2026-05-01T01:00:00.000Z', channel: 'ios-context', context: { ...context, native: { trigger: 'reporter_start', memoryWarningCount: 0, residentMemoryBytes: 10485760 } } },
      { receivedAt: '2026-05-01T01:01:00.000Z', channel: 'ios-context', context: { ...context, native: { trigger: 'network_change', memoryWarningCount: 0, residentMemoryBytes: 20971520 } } },
      { receivedAt: '2026-05-01T01:02:00.000Z', channel: 'ios-context', context: { ...context, native: { trigger: 'memory_warning', memoryWarningCount: 1, residentMemoryBytes: 31457280 } } },
    ];
    await writeFile(join(dataDir, 'ios-context-2026-05-01.ndjson'), snapshots.map((event) => JSON.stringify(event)).join('\n') + '\n');
    await writeFile(join(dataDir, 'h5-beacon-2026-05-01.ndjson'), `${JSON.stringify({
      channel: 'h5-beacon', receivedAt: '2026-05-01T01:03:00.000Z',
      parsed: { header: { pid: 'pid', uid: context.contextId, sid: 'sid' }, logCount: 1,
        logs: [{ type: 'perf', common: { page: 'https://h5.test/a' }, log: { total: '1500' } }] },
    })}\n`);
    const result = await aggregateDashboard({ dataDir, date: '2026-05-01' });
    assert.equal(result.native.contexts, 1);
    assert.equal(result.native.snapshots, 3);
    assert.equal(result.native.memoryWarnings, 1);
    assert.equal(result.native.networkChanges, 1);
    assert.equal(result.native.latestResidentMemoryBytes, 31457280);
    assert.equal(result.native.latestTrigger, 'memory_warning');
    assert.equal(result.native.latestAt, '2026-05-01T01:02:00.000Z');
    assert.equal(result.native.matchedPageViews, 0);
    assert.equal(result.native.matchedVisitors, 0);
    assert.deepEqual(result.native.dimensions.deviceModel, [{ value: 'iPhone', count: 1, rate: 100 }]);
    assert.deepEqual(result.native.linkedPageViewDimensions.deviceModel, []);
    assert.equal(result.userPerception.contextCoverage.exact, 1);
    assert.equal(result.userPerception.contextCoverage.contexts, 1);
    assert.equal(result.userPerception.contextCoverage.singleContextFallback, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

// An old desktop performance visit must not inherit dimensions from later native visits.
test('separates native PV-linked context dimensions from unlinked historical performance', async () => {
  const dataDir = await mkdtemp();
  try {
    const contexts = [
      { contextId: 'native-A', device: { model: 'iPhone', os: 'iOS', osVersion: '13.6' }, app: { version: '1.1.7' }, network: { type: 'wifi' }, region: { country: 'CN' } },
      { contextId: 'native-B', device: { model: 'iPad', os: 'iPadOS', osVersion: '18.1' }, app: { version: '2.0' }, network: { type: '5g' } },
    ];
    await writeFile(join(dataDir, 'ios-context-2026-10-16.ndjson'), [
      ...contexts.map((context) => JSON.stringify({ channel: 'ios-context', context })),
      JSON.stringify({ channel: 'ios-context', context: contexts[0] }),
    ].join('\n') + '\n');
    const perf = { type: 'perf', common: { page: 'https://h5.example.com/home', ct: '4g' }, log: { total: '900' } };
    const pv = { type: 'pv', common: { page: 'https://h5.example.com/home' }, log: {} };
    await writeFile(join(dataDir, 'h5-beacon-2026-10-16.ndjson'), [
      record('h5-beacon', '2026-10-16T01:00:00Z', [perf], { uid: 'desktop' }),
      record('h5-beacon', '2026-10-16T02:00:00Z', [pv, pv], { uid: 'native-A' }),
      record('h5-beacon', '2026-10-16T02:01:00Z', [pv], { uid: 'desktop' }),
    ].join('\n') + '\n');
    const result = await aggregateDashboard({ dataDir, date: '2026-10-16' });
    assert.equal(result.userPerception.contextCoverage.exact, 0);
    assert.deepEqual(result.userPerception.dimensions.deviceModel, []);
    assert.equal(result.native.contexts, 2);
    assert.equal(result.native.matchedPageViews, 2);
    assert.equal(result.native.matchedVisitors, 1);
    assert.deepEqual(result.native.linkedPageViewDimensions.deviceModel, [{ value: 'iPhone', count: 1, rate: 100 }]);
    assert.deepEqual(result.native.dimensions.deviceModel, [
      { value: 'iPad', count: 1, rate: 50 }, { value: 'iPhone', count: 1, rate: 50 },
    ]);
    assert.deepEqual(result.native.dimensions.carrier, []);
    assert.deepEqual(result.native.dimensions.region, [{ value: 'CN', count: 1, rate: 100 }]);
    await writeFile(join(dataDir, 'h5-logs-2026-10-16.ndjson'), record('h5-logs', '2026-10-16T03:00:00Z', [perf], { uid: 'native-A' }) + '\n');
    const linked = await aggregateDashboard({ dataDir, date: '2026-10-16' });
    assert.equal(linked.userPerception.contextCoverage.exact, 1);
    assert.deepEqual(linked.userPerception.dimensions.deviceModel, [{ value: 'iPhone', count: 1, rate: 100 }]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('receive-time range merges days before computing percentiles and keeps trend days distinct', async () => {
  const dataDir = await mkdtemp();
  try {
    const perf = (total) => ({ type: 'perf', common: { page: '/lesson' }, log: { total: String(total), fpt: String(total) } });
    await writeFile(join(dataDir, 'h5-beacon-2026-10-15.ndjson'), [
      record('h5-beacon', '2026-10-15T12:00:00.000Z', [perf(100)]),
      record('h5-beacon', '2026-10-15T23:00:00.000Z', [perf(900)]),
    ].join('\n') + '\n');
    await writeFile(join(dataDir, 'h5-beacon-2026-10-16.ndjson'), [
      record('h5-beacon', '2026-10-16T12:00:00.000Z', [perf(300)]),
      record('h5-beacon', '2026-10-16T13:00:00.000Z', [perf(700)]),
      record('h5-beacon', '2026-10-16T14:00:00.000Z', [perf(1100)]),
      '{broken',
    ].join('\n') + '\n');
    const result = await aggregateDashboard({ dataDir, from: '2026-10-15T23:00:00.000Z', to: '2026-10-16T14:00:00.000Z' });
    assert.equal(result.userPerception.metrics.fp.count, 3);
    assert.equal(result.userPerception.metrics.fp.p50, 700);
    assert.equal(result.userPerception.metrics.fp.p90, 900);
    assert.equal(result.archive.malformedLines, 1);
    assert.equal(result.trend.length, 15);
    assert.equal(result.trend.find((point) => point.hour === '2026-10-15 23').metrics.fp.count, 1);
    assert.equal(result.trend.find((point) => point.hour === '2026-10-16 12').metrics.fp.count, 1);
    const longer = await aggregateDashboard({ dataDir, from: '2026-10-15T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' });
    assert.equal(longer.trend.length, 48);
    assert.equal(longer.userPerception.metrics.fp.count, 5);
    assert.equal(longer.userPerception.metrics.fp.p50, 700);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('range rejects incomplete, invalid, reversed, overlong and ambiguous windows', async () => {
  const dataDir = await mkdtemp();
  try {
    const from = '2026-10-01T00:00:00.000Z', to = '2026-10-02T00:00:00.000Z';
    for (const input of [{ from }, { to }, { from, to, date: '2026-10-01' },
      { from: to, to: from }, { from, to: '2027-02-01T00:00:00.000Z' },
      { from: '2026-02-30T00:00:00.000Z', to }, { from: 'foo', to }]) {
      await assert.rejects(aggregateDashboard({ dataDir, ...input }), { code: 'INVALID_RANGE' });
    }
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('range joins iOS contexts received up to 24 hours before the selected interval', async () => {
  const dataDir = await mkdtemp();
  try {
    await writeFile(join(dataDir, 'ios-context-2026-10-15.ndjson'), JSON.stringify({ receivedAt:'2026-10-15T23:30:00.000Z', channel:'ios-context', context:{contextId:'visitor',device:{model:'iPhone'} } }) + '\n');
    await writeFile(join(dataDir, 'h5-navigation-2026-10-16.ndjson'), record('h5-navigation', '2026-10-16T00:30:00.000Z', [{ type:'perf',common:{page:'/lesson'},log:{total:500} }], {uid:'visitor'}) + '\n');
    const linked = await aggregateDashboard({dataDir,from:'2026-10-15T23:00:00.000Z',to:'2026-10-16T01:00:00.000Z'});
    assert.equal(linked.userPerception.contextCoverage.exact, 1);
    const unlinked = await aggregateDashboard({dataDir,from:'2026-10-16T00:00:00.000Z',to:'2026-10-16T01:00:00.000Z'});
    assert.equal(unlinked.userPerception.contextCoverage.exact, 1);
    assert.equal(unlinked.native.lookbackContexts, 1);
    assert.equal(unlinked.native.snapshots, 0);
    assert.equal(unlinked.userPerception.metrics.fp.count, 0);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('one-hour windows use distinct five-minute UTC buckets and an empty window stays empty', async () => {
  const dataDir = await mkdtemp();
  try {
    const event = (receivedAt, total) => record('h5-logs', receivedAt, [{type:'perf',common:{page:'/a'},log:{total:String(total)}}]);
    await writeFile(join(dataDir,'h5-logs-2026-10-16.ndjson'), [
      event('2026-10-16T04:05:00.000Z', 100),
      event('2026-10-16T04:10:00.000Z', 200),
      event('2026-10-16T05:00:00.000Z', 300),
    ].join('\n') + '\n');
    const short = await aggregateDashboard({dataDir,from:'2026-10-16T04:00:00.000Z',to:'2026-10-16T05:00:00.000Z'});
    assert.equal(short.trend.length, 12);
    assert.equal(short.userPerception.metrics.fp.count, 0);
    assert.equal(short.performance.pageLoad.count, 2);
    assert.equal(short.trend.find((point) => point.hour === '04:05').metrics.pageLoad.count, 1);
    assert.equal(short.trend.find((point) => point.hour === '04:10').metrics.pageLoad.count, 1);
    const empty = await aggregateDashboard({dataDir,from:'2026-10-15T01:00:00.000Z',to:'2026-10-15T02:00:00.000Z'});
    assert.equal(empty.performance.pageLoad.count, 0);
    assert.equal(empty.trend.length, 12);
    const long = await aggregateDashboard({dataDir,from:'2026-07-18T16:00:00.000Z',to:'2026-10-16T05:00:00.000Z'});
    assert.equal(long.trend.length, 91);
    assert.equal(long.performance.pageLoad.count, 2);
  } finally { await rm(dataDir,{recursive:true,force:true}); }
});

test('client occurrence time filters individual logs and excludes missing or skewed clocks', async () => {
  const dataDir = await mkdtemp();
  try {
    const ctime = (time) => String(Date.parse(time));
    await writeFile(join(dataDir, 'h5-logs-2026-10-16.ndjson'), record('h5-logs', '2026-10-16T01:05:00.000Z', [
      { type: 'perf', common: { page: '/now', ctime: ctime('2026-10-16T01:01:00.000Z') }, log: { total: 800 } },
      { type: 'perf', common: { page: '/previous', ctime: ctime('2026-10-16T00:45:00.000Z') }, log: { total: 1600 } },
      { type: 'perf', common: { page: '/missing' }, log: { total: 300 } },
      { type: 'perf', common: { page: '/skewed', ctime: ctime('2026-09-16T01:05:00.000Z') }, log: { total: 400 } },
    ]) + '\n');
    const result = await aggregateDashboard({ dataDir, from: '2026-10-16T01:00:00.000Z',
      to: '2026-10-16T02:00:00.000Z', timeField: 'clientAt' });
    assert.equal(result.range.timeField, 'clientAt');
    assert.equal(result.performance.pageLoad.count, 1);
    assert.equal(result.performance.pageLoad.p50, 800);
    assert.equal(result.clientTimeCoverage.missingOrSkewed, 2);
    assert.equal(result.clientTimeCoverage.outsideWindow, 1);
    assert.equal(result.userPerception.previous.metrics.fp.count, 0);
    assert.equal(result.userPerception.previous.metrics.twoSecondFastRate.sampleCount, 1);
    assert.equal(result.userPerception.previous.metrics.twoSecondFastRate.rate, 100);
    await assert.rejects(aggregateDashboard({ dataDir, timeField: 'bad' }), { code: 'INVALID_TIME_FIELD' });
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('lookback context requires exact identity and a preceding snapshot within 24 hours', async () => {
  const dataDir = await mkdtemp();
  try {
    await writeFile(join(dataDir, 'ios-context-2026-10-15.ndjson'), [
      { receivedAt: '2026-10-15T23:00:00.000Z', channel: 'ios-context', context: { contextId: 'same-id', device: { model: 'iPhone' }, native: { trigger: 'reporter_start' } } },
      { receivedAt: '2026-10-15T00:00:00.000Z', channel: 'ios-context', context: { contextId: 'stale-id', device: { model: 'iPad' } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await writeFile(join(dataDir, 'h5-logs-2026-10-16.ndjson'), [
      record('h5-logs', '2026-10-16T00:05:00.000Z', [{ type: 'perf', common: { page: '/a' }, log: { total: 500 } }], { uid: 'same-id' }),
      record('h5-logs', '2026-10-16T00:06:00.000Z', [{ type: 'perf', common: { page: '/b' }, log: { total: 500 } }], { uid: 'stale-id' }),
    ].join('\n') + '\n');
    const result = await aggregateDashboard({ dataDir, from: '2026-10-16T00:00:00.000Z', to: '2026-10-16T01:00:00.000Z' });
    assert.equal(result.userPerception.contextCoverage.exact, 1);
    assert.equal(result.native.lookbackContexts, 2);
    assert.equal(result.native.snapshots, 0);
    assert.deepEqual(result.userPerception.dimensions.deviceModel, [{ value: 'iPhone', count: 1, rate: 100 }]);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('a later context update does not replace the preceding snapshot for an earlier H5 sample', async () => {
  const dataDir = await mkdtemp();
  try {
    await writeFile(join(dataDir, 'ios-context-2026-10-16.ndjson'), [
      { receivedAt: '2026-10-16T00:01:00.000Z', context: { contextId: 'visitor-123', device: { model: 'iPhone' } } },
      { receivedAt: '2026-10-16T00:45:00.000Z', context: { contextId: 'visitor-123', device: { model: 'iPad' } } },
    ].map(JSON.stringify).join('\n') + '\n');
    await writeFile(join(dataDir, 'h5-logs-2026-10-16.ndjson'), record('h5-logs', '2026-10-16T00:30:00.000Z', [
      { type: 'perf', common: { page: '/test' }, log: { total: 900 } },
    ], { uid: 'visitor-123' }) + '\n');
    const result = await aggregateDashboard({ dataDir, from: '2026-10-16T00:00:00.000Z', to: '2026-10-16T01:00:00.000Z' });
    assert.equal(result.userPerception.contextCoverage.exact, 1);
    assert.deepEqual(result.userPerception.dimensions.deviceModel, [{ value: 'iPhone', count: 1, rate: 100 }]);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});

test('MetricKit summaries show only the latest received diagnostic period without inventing live crashes', async () => {
  const dataDir = await mkdtemp();
  try {
    const base = { schema: 'ios-context-v1', contextId: 'AABBCCDDEEFF00112233445566778899' };
    const makeEvent = (receivedAt, crashes, hangs) => JSON.stringify({
      channel: 'ios-context', receivedAt,
      context: { ...base, native: { trigger: 'metrickit_diagnostics', diagnostics: {
        source: 'MetricKit', periodStart: '2026-05-01T00:00:00Z', periodEnd: '2026-05-02T00:00:00Z',
        crashes, hangs,
      } } },
    });
    await writeFile(join(dataDir, 'ios-context-2026-05-02.ndjson'), [
      makeEvent('2026-05-02T01:00:00.000Z', 1, 2),
      makeEvent('2026-05-02T02:00:00.000Z', 1, 2), // duplicate delivery is not summed
    ].join('\n') + '\n');
    const result = await aggregateDashboard({ dataDir, date: '2026-05-02' });
    assert.equal(result.native.snapshots, 2);
    assert.equal(result.native.latestDiagnostics.crashes, 1);
    assert.equal(result.native.latestDiagnostics.hangs, 2);
    assert.equal(result.native.latestDiagnostics.receivedAt, '2026-05-02T02:00:00.000Z');
    const before = await aggregateDashboard({ dataDir, from: '2026-05-02T00:00:00.000Z', to: '2026-05-02T00:30:00.000Z' });
    assert.equal(before.native.latestDiagnostics, null);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('performance dimensions filter all H5 evidence while keeping native context evidence independent', async () => {
  const dataDir = await mkdtemp();
  try {
    const at = '2026-10-16T01:00:00.000Z';
    await writeFile(join(dataDir, 'ios-context-2026-10-16.ndjson'), [
      { receivedAt: '2026-10-16T00:01:00.000Z', context: { contextId: 'a', app: { version: '1.0', bundleIdentifier: 'org.example.alpha' }, device: { model: 'iPhone' }, network: { carrier: 'A', type: 'wifi' } } },
      { receivedAt: '2026-10-16T00:02:00.000Z', context: { contextId: 'b', app: { version: '2.0', bundleIdentifier: 'org.example.beta' }, device: { model: 'iPad' }, network: { type: 'cellular' } } },
    ].map((item) => JSON.stringify(item)).join('\n') + '\n');
    const perf = (uid, total) => record('h5-logs', at, [
      { type: 'pv', common: { page: '/learning' }, log: {} },
      { type: 'perf', common: { page: '/learning' }, log: { total, fpt: total } },
    ], { uid, sid: uid, pid: 'p', js_ver: '2.0.10' });
    await writeFile(join(dataDir, 'h5-logs-2026-10-16.ndjson'), [perf('a', '1000'), perf('b', '6000'), perf('unlinked', '3000')].join('\n') + '\n');
    const all = await aggregateDashboard({ dataDir, date: '2026-10-16' });
    assert.deepEqual(all.userPerception.filterOptions.deviceModel, ['iPad', 'iPhone']);
    assert.deepEqual(all.userPerception.filterOptions.bundleIdentifier, ['org.example.alpha', 'org.example.beta']);
    assert.deepEqual(all.userPerception.filterOptions.sdkVersion, ['2.0.10']);
    assert.deepEqual(all.userPerception.filterOptions.channel, []);
    assert.deepEqual(all.userPerception.filterOptions.networkType, ['cellular', 'wifi']);
    const selected = await aggregateDashboard({ dataDir, date: '2026-10-16', performanceFilters: { deviceModel: 'iPhone', bundleIdentifier: 'org.example.alpha' } });
    assert.equal(selected.userPerception.contextCoverage.total, 1);
    assert.equal(selected.userPerception.metrics.fp.count, 1);
    assert.equal(selected.userPerception.metrics.fp.average, 1000);
    assert.equal(selected.slowLoading.overview.samples, 1);
    assert.equal(selected.overview.pageViews, 1);
    assert.equal(selected.native.contexts, 2);
    const wifi = await aggregateDashboard({ dataDir, date: '2026-10-16', performanceFilters: { networkType: 'wifi' } });
    assert.equal(wifi.userPerception.metrics.fp.count, 1);
    assert.equal(wifi.overview.pageViews, 1);
    const missing = await aggregateDashboard({ dataDir, date: '2026-10-16', performanceFilters: { channel: 'not-collected' } });
    assert.equal(missing.userPerception.contextCoverage.total, 0);
    assert.deepEqual(missing.userPerception.pages, []);
    assert.deepEqual(missing.userPerception.filterOptions.deviceModel, ['iPad', 'iPhone']);
    await assert.rejects(() => aggregateDashboard({ dataDir, date: '2026-10-16', performanceFilters: { invalid: 'x' } }), { code: 'INVALID_PERFORMANCE_FILTER' });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('page path and host filters apply consistently to every H5 dashboard metric', async () => {
  const dataDir = await mkdtemp();
  try {
    const logs = [
      { type: 'pv', common: { page: 'https://m.gsx.com/home?from=push' }, log: {} },
      { type: 'api', common: { page: 'https://m.gsx.com/home' }, log: { url: 'https://api.gsx.com/home', rc: '200', rt: '120' } },
      { type: 'error', common: { page: 'https://m.gsx.com/home' }, log: { name: 'TypeError', reasonCode: 'uncaught_exception', msg: 'home failed' } },
      { type: 'perf', common: { page: 'https://m.gsx.com/home' }, log: { total: '800', fpt: '400' } },
      { type: 'pv', common: { page: 'https://m.gsx.com/course' }, log: {} },
      { type: 'api', common: { page: 'https://m.gsx.com/course' }, log: { url: 'https://api.gsx.com/course', rc: '500', rt: '300' } },
      { type: 'error', common: { page: 'https://m.gsx.com/course' }, log: { name: 'NetworkError', reasonCode: 'http_failure', msg: 'course failed' } },
      { type: 'perf', common: { page: 'https://m.gsx.com/course' }, log: { total: '1800', fpt: '1200' } },
      { type: 'pv', common: { page: 'www.other.example/other' }, log: {} },
    ];
    await writeFile(join(dataDir, 'h5-logs-2026-10-16.ndjson'), `${record('h5-logs', '2026-10-16T01:00:00.000Z', logs, { uid: 'visitor-1', sid: 'session-1' })}\n`);

    const pathFiltered = await aggregateDashboard({ dataDir, date: '2026-10-16', pageFilter: '/home' });
    assert.equal(pathFiltered.overview.pageViews, 1);
    assert.equal(pathFiltered.overview.apiRequests, 1);
    assert.equal(pathFiltered.overview.errors, 1);
    assert.equal(pathFiltered.overview.uniqueVisitors, 1);
    assert.equal(pathFiltered.pages.length, 1);
    assert.equal(pathFiltered.apis.length, 1);
    assert.equal(pathFiltered.errors.length, 1);
    assert.equal(pathFiltered.performance.pageLoad.count, 1);
    assert.equal(pathFiltered.trend.reduce((sum, bucket) => sum + bucket.pageViews, 0), 1);
    assert.deepEqual(pathFiltered.userPerception.activePageFilter, { pageFilter: '/home', pageHost: '' });

    const hostFiltered = await aggregateDashboard({ dataDir, date: '2026-10-16', pageHost: 'm.gsx.com' });
    assert.equal(hostFiltered.overview.pageViews, 2);
    assert.equal(hostFiltered.overview.apiRequests, 2);
    assert.equal(hostFiltered.overview.errors, 2);
    assert.equal(hostFiltered.pages.length, 2);
    assert.equal(hostFiltered.apis.length, 2);
    assert.equal(hostFiltered.errors.length, 2);
    assert.equal(hostFiltered.performance.pageLoad.count, 2);

    const combined = await aggregateDashboard({ dataDir, date: '2026-10-16', pageFilter: '/course', pageHost: 'm.gsx.com' });
    assert.equal(combined.overview.pageViews, 1);
    assert.equal(combined.pages[0].page, 'https://m.gsx.com/course');
    assert.equal(combined.apis[0].api, 'https://api.gsx.com/course');
    assert.equal(combined.errors[0].name, 'NetworkError');
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('filtered navigation fallback keeps real load samples without inventing missing paint milestones', async () => {
  const dataDir = await mkdtemp();
  try {
    await writeFile(join(dataDir, 'ios-context-2026-10-16.ndjson'), JSON.stringify({
      receivedAt: '2026-10-16T00:01:00.000Z',
      context: { contextId: 'native', device: { model: 'iPhone' }, network: { type: 'wifi' } },
    }) + '\n');
    await writeFile(join(dataDir, 'h5-navigation-2026-10-16.ndjson'), record('h5-navigation', '2026-10-16T00:10:00.000Z', [
      { type: 'perf', common: { page: '/learning' }, log: { total: 800 } },
    ], { uid: 'native' }) + '\n');
    await writeFile(join(dataDir, 'h5-beacon-2026-10-16.ndjson'), record('h5-beacon', '2026-10-16T00:11:00.000Z', [
      { type: 'perf', common: { page: '/learning', ct: '4g' }, log: { total: 1000, fpt: 400, fcp: 500, tti: 600 } },
    ], { uid: 'h5' }) + '\n');
    const all = await aggregateDashboard({ dataDir, date: '2026-10-16' });
    assert.equal(all.userPerception.contextCoverage.total, 2);
    assert.equal(all.userPerception.missingMilestoneSamples, 1);
    assert.equal(all.userPerception.navigationMissingMilestoneSamples, 1);
    const device = await aggregateDashboard({ dataDir, date: '2026-10-16', performanceFilters: { deviceModel: 'iPhone' } });
    assert.equal(device.userPerception.contextCoverage.total, 1);
    assert.equal(device.userPerception.navigationFallbackSamples, 1);
    assert.equal(device.userPerception.missingMilestoneSamples, 1);
    assert.equal(device.userPerception.navigationMissingMilestoneSamples, 1);
    assert.equal(device.userPerception.metrics.fp.count, 0);
    assert.equal(device.userPerception.metrics.fcp.count, 0);
    assert.equal(device.userPerception.metrics.tti.count, 0);
    assert.equal(device.userPerception.metrics.oneSecondFastRate.sampleCount, 1);
    const network = await aggregateDashboard({ dataDir, date: '2026-10-16', performanceFilters: { networkType: '4g' } });
    assert.equal(network.userPerception.metrics.fp.count, 1);
    assert.equal(network.userPerception.metrics.fcp.count, 1);
    assert.equal(network.userPerception.metrics.tti.count, 1);
    assert.equal(network.userPerception.missingMilestoneSamples, 0);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
