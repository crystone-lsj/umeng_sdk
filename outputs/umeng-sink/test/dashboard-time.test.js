import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { dashboardHtml } from '../src/dashboard.js';

test('dashboard browser script formats instants and trend buckets in the viewer timezone', () => {
  const script = dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const functions = script.slice(script.indexOf('function datetime('), script.indexOf('function apiPath('));
  const expression = `${functions}\nconsole.log(JSON.stringify([
    datetime('2026-10-20T18:57:24.000Z'),
    trendLabel({hour: '2026-10-20 18'}, 0, {range:{bucket:'utc-hour',from:'2026-10-20T18:00:00.000Z'}}),
    trendLabel({hour: '18:55'}, 0, {range:{bucket:'utc-5-minute',from:'2026-10-20T18:57:00.000Z'}}),
    trendLabel({hour: '2026-10-20'}, 0, {range:{bucket:'utc-day',from:'2026-10-20T00:00:00.000Z'}})
  ]));`;
  const run = (timezone) => JSON.parse(execFileSync(process.execPath, ['-e', expression],
    { env: { ...process.env, TZ: timezone }, encoding: 'utf8' }));
  assert.deepEqual(run('Asia/Shanghai'), ['2026-10-21 02:57:24', '10-21 02:00', '10-21 02:55', '2026-10-20']);
  assert.deepEqual(run('America/New_York'), ['2026-10-20 14:57:24', '10-20 14:00', '10-20 14:55', '2026-10-19']);
});
