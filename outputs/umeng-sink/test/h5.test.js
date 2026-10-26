import assert from 'node:assert/strict';
import test from 'node:test';

import { detectCommonSchema, parseDcArgs, parseH5Body } from '../src/h5.js';

/**
 * Golden body produced by an independent implementation of the `cn()`/`an()`
 * encoder in @umengfe/apm 2.0.11, including a URL whose comma is URI-encoded so
 * the log splitter can be checked against real data.
 */
const GOLDEN_BODY = [
  '2.0.10|694a02588560e348720def2a|sid-abc123|u-1001|-|paid|1.2.0|prod|AX1234567890',
  '|^|',
  'pv|https%3A%2F%2Fm.gsx.com%2Fhome%3Ffrom%3Dpush|1|100|pv-1|1|390x844|390x844|Y|1766195800123|0|$|Y|Y|Y|N',
  ',api|https%3A%2F%2Fm.gsx.com%2Fhome|2|30|pv-1|2|390x844|390x844|Y|1766195801456|0',
  '|$|https%3A%2F%2Fapi.gsx.com%2Fv1%2Flist%3Fa%3D1%2Cb%3D2|GET|321|200|xhr|-|%7B%22a%22%3A%221%2Cb%22%7D|-',
  ',error|https%3A%2F%2Fm.gsx.com%2Fquiz|3|100|pv-2|3|390x844|390x844|N|1766195802999|1',
  '|$|TypeError|Cannot%20read%20properties%20of%20undefined%20(reading%20%22id%22)',
  '|TypeError%3A%20x%0A%20%20%20%20at%20Quiz.vue%3A42%3A7|https%3A%2F%2Fm.gsx.com%2Fassets%2Findex-abc.js|42|7',
].join('');

test('parses the golden H5 body', () => {
  const parsed = parseH5Body(GOLDEN_BODY);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.logCount, 3);
});

test('decodes the header schema', () => {
  const { header } = parseH5Body(GOLDEN_BODY);
  assert.deepEqual(header.raw, [
    '2.0.10',
    '694a02588560e348720def2a',
    'sid-abc123',
    'u-1001',
    null,
    'paid',
    '1.2.0',
    'prod',
    'AX1234567890',
  ]);
  assert.equal(header.pid, '694a02588560e348720def2a');
  assert.equal(header.puid, null); // '-' means absent, not the string '-'
  assert.equal(header.cna, 'AX1234567890');
  assert.deepEqual(header.extra, []);
});

test('splits logs on the $ marker and labels type-specific fields', () => {
  const parsed = parseH5Body(GOLDEN_BODY);
  const [pv, api, error] = parsed.logs;

  assert.equal(pv.type, 'pv');
  assert.equal(pv.common.page, 'https://m.gsx.com/home?from=push');
  assert.equal(pv.common.ctime, '1766195800123');
  assert.deepEqual(pv.log, { enable_api: 'Y', enable_error: 'Y', enable_perf: 'Y', enable_blank: 'N' });

  assert.equal(api.type, 'api');
  assert.equal(api.log.url, 'https://api.gsx.com/v1/list?a=1,b=2');
  assert.equal(api.log.rc, '200');
  assert.equal(api.log.traceid, null);
  assert.deepEqual(JSON.parse(api.log.req_query), { a: '1,b' });

  assert.equal(error.type, 'error');
  assert.equal(error.log.name, 'TypeError');
  assert.equal(error.log.line, '42');
  assert.match(error.log.stack, /at Quiz\.vue:42:7/);
});

test('URI-encoded commas inside a field do not create extra logs', () => {
  const parsed = parseH5Body(GOLDEN_BODY);
  assert.equal(parsed.logs.length, 3);
  assert.equal(parsed.logs[1].log.url.includes(','), true);
});

test('recognises both in-bundle log schemas', () => {
  assert.equal(detectCommonSchema(['pv', 'https://x', '1']), 'v1');
  assert.equal(detectCommonSchema(['perf', '2.0.10', 'https://x']), 'v2');
  assert.equal(detectCommonSchema(['pv']), null);

  // `Nn()` walks `An.perf` positionally, so the perf slot count is fixed at 19:
  // appcache,dns,tcp,ssl,ttfb,trans,dom,res,firstbyte,fpt,fcp,tti,ready,load,
  // total,unload,redirect,begin,navtype.
  const v2 = [
    '2.0.10|pid|sid|uid|-|tag|1.2.0|prod|cna|^|',
    'perf|2.0.10|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pid|sid|uid|pv-1|tag|1.2.0|prod|1|390x844|390x844|Y|1766195800000',
    '|$|-|12|34|56|78|90|12|34|56|78|850|12|34|56|78|90|12|34|navigate',
  ].join('');
  const parsed = parseH5Body(v2);
  assert.equal(parsed.logs[0].schema, 'v2');
  assert.equal(parsed.logs[0].type, 'perf');
  assert.equal(parsed.logs[0].common.js_ver, '2.0.10');
  assert.equal(parsed.logs[0].common.page, 'https://m.gsx.com/home');
  assert.equal(parsed.logs[0].log.appcache, null);
  assert.equal(parsed.logs[0].log.navtype, 'navigate');
  assert.equal(parsed.logs[0].log.fcp, '850');
  assert.equal(parsed.logs[0].log.jump, undefined);
});

test('v1 and v2 perf tails are labelled by their own schemas', () => {
  // v1 (`an()`/`on`) has 20 slots; position 10 is the wire field `!fcp`, which
  // the client always writes as `-`, and the last slot is `jump`.
  const v1Perf = [
    '2.0.10|pid|sid|uid|-|tag|1.2.0|prod|cna|^|',
    'perf|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pv-1|1|390x844|390x844|Y|1766195800000|0',
    '|$|-|12|34|56|78|90|12|34|56|78|-|12|34|56|78|90|12|34|navigate|N',
  ].join('');
  const v1Parsed = parseH5Body(v1Perf);
  assert.equal(v1Parsed.logs[0].schema, 'v1');
  assert.equal(v1Parsed.logs[0].log['!fcp'], null);
  assert.equal(v1Parsed.logs[0].log.navtype, 'navigate');
  assert.equal(v1Parsed.logs[0].log.jump, 'N');
  assert.equal(v1Parsed.logs[0].logExtraValues.length, 0);
});

test('v2 error logs use the msg|stack|file|line|col tail', () => {
  const v2Error = [
    '2.0.10|pid|sid|uid|-|tag|1.2.0|prod|cna|^|',
    'error|2.0.10|https%3A%2F%2Fm.gsx.com%2Fquiz|1|100|pid|sid|uid|pv-1|tag|1.2.0|prod|1|390x844|390x844|N|1766195800000',
    '|$|TypeError%3A%20boom|TypeError%3A%20boom%0A%20%20%20%20at%20Quiz.vue%3A42%3A7|https%3A%2F%2Fm.gsx.com%2Fa.js|42|7',
  ].join('');
  const parsed = parseH5Body(v2Error);
  assert.equal(parsed.logs[0].schema, 'v2');
  assert.equal(parsed.logs[0].log.name, undefined);
  assert.equal(parsed.logs[0].log.msg, 'TypeError: boom');
  assert.match(parsed.logs[0].log.stack, /at Quiz\.vue:42:7/);
  assert.equal(parsed.logs[0].log.file, 'https://m.gsx.com/a.js');
  assert.equal(parsed.logs[0].log.line, '42');
  assert.equal(parsed.logs[0].log.col, '7');
  assert.equal(parsed.logs[0].logExtraValues.length, 0);
});

test('unknown log types keep positional values instead of dropping them', () => {
  const body = '2.0.10|pid|sid|uid|-|tag|rel|env|cna|^|custom|https%3A%2F%2Fx|1|100|pv|1|sr|vp|Y|1|0|$|a|b';
  const parsed = parseH5Body(body);
  assert.equal(parsed.logs[0].type, 'custom');
  assert.deepEqual(parsed.logs[0].log, {});
  assert.deepEqual(parsed.logs[0].logExtraValues, ['a', 'b']);
});

test('a body without the separator is reported, not guessed', () => {
  const parsed = parseH5Body('garbage');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, 'missing body separator');
  assert.equal(parsed.raw, 'garbage');
});

test('empty log list is valid', () => {
  const parsed = parseH5Body('2.0.10|pid|sid|uid|-|tag|rel|env|cna|^|');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.logCount, 0);
  assert.deepEqual(parsed.logs, []);
});

test('dc-args is decoded when present', () => {
  // URLSearchParams already percent-decodes query values before they reach us.
  assert.equal(parseDcArgs(null), null);
  assert.equal(parseDcArgs(''), null);
  assert.deepEqual(parseDcArgs(JSON.stringify({ key: 'k', iv: 'i' })), { key: 'k', iv: 'i' });
});

test('dc-args keeps the raw value when it is not valid JSON', () => {
  const parsed = parseDcArgs('{not-json');
  assert.equal(parsed.parseError, true);
  assert.equal(parsed.raw, '{not-json');
});
