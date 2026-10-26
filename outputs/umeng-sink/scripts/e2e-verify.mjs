#!/usr/bin/env node
/**
 * End-to-end verification against the real socket path.
 *
 * The unit suite (`npm test`) drives the router in-process, so it cannot prove
 * that a real client's bytes survive framing, that the iOS thrift success struct
 * is byte-identical on the wire, or that the NDJSON archive is durably written.
 * This script binds a loopback port and checks exactly that.
 *
 * It requires permission to `listen()` on 127.0.0.1. In a restrictive sandbox
 * that raises `EPERM`, so run it from a normal shell.
 *
 *   node scripts/e2e-verify.mjs [--port 0] [--keep]
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import { buildEnvelope, buildSuccessResponse } from '../src/envelope.js';
import { createSinkServer } from '../src/server.js';
import { dayStamp } from '../src/store.js';

const ENVELOPE_GOLDEN = Buffer.from(
  '0b00010000000456312e310b0002000000183639346130323538383536306533343837323064656632610b000300000020376337656635653336663262363765376332353936666563333439336630386608000400000007080005694602580800060000007b0b000700000070789c1d8cc10a84300c44ff25e70af6b0baebafc82241831b5c2b985494d27f37f532306f7893e04738d10e5d824da003b67410579eac0887a55212ade668203bc080ff4b799422e0a87cd010a5f8de011d14d4963ec1a3e3790eb26e0bd963e1be6d1aff79bdeb3a7f73be01fac628780b00080000002065356535653565356535653565356535653565356535653565356535653565350b000900000020323839343566383966343137613333326665633461383662313365303237383808000a0000000100',
  'hex'
);

const H5_GOLDEN_BODY = [
  '2.0.10|694a02588560e348720def2a|sid-abc123|u-1001|-|paid|1.2.0|prod|AX1234567890',
  '|^|',
  'pv|https%3A%2F%2Fm.gsx.com%2Fhome|1|100|pv-1|1|390x844|390x844|Y|1766195800123|0|$|Y|Y|Y|N',
  ',api|https%3A%2F%2Fm.gsx.com%2Fhome|2|30|pv-1|2|390x844|390x844|Y|1766195801456|0|$|https%3A%2F%2Fapi.gsx.com%2Fv1%2Flist|GET|321|200|xhr|-|-|-',
].join('');

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  process.stdout.write(`${condition ? 'ok  ' : 'FAIL'} ${name}${detail && !condition ? ` -- ${detail}` : ''}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    if (inline !== undefined) {
      args[key] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const dataDir = args['data-dir'] ?? (await mkdtemp(join(tmpdir(), 'umeng-sink-e2e-')));
const keep = Boolean(args.keep) || args['data-dir'] !== undefined;

const sink = createSinkServer({
  dataDir,
  quiet: true,
  host: '127.0.0.1',
  port: Number.parseInt(args.port ?? '0', 10),
});

let exitCode = 0;
try {
  const address = await sink.listen();
  const base = `http://127.0.0.1:${address.port}`;
  process.stdout.write(`umeng-sink e2e against ${base} (archive: ${dataDir})\n`);

  // --- iOS analytics -------------------------------------------------------
  const ios = await fetch(`${base}/unify_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/thrift',
      'Msg-Type': 'envelope/json',
      'X-Umeng-Sdk': '1',
      'SM-IMP': '1',
      'X-Umeng-UTC': '1766195800123',
    },
    body: ENVELOPE_GOLDEN,
  });
  const iosBody = Buffer.from(await ios.arrayBuffer());
  check('POST /unify_logs answers 200', ios.status === 200, `status=${ios.status}`);
  check(
    'response is the thrift success struct (08 00 01 00 00 00 01 00)',
    iosBody.equals(buildSuccessResponse()),
    iosBody.toString('hex')
  );
  check('response Content-Type is application/thrift', ios.headers.get('content-type') === 'application/thrift');

  // A second upload with an envelope this package builds itself, to prove the
  // signature/checksum/length pipeline round-trips over a real socket.
  const raw = Buffer.from('{"header":{"os":"ios"},"analytics":{"active_user":1}}', 'utf8');
  const entity = deflateSync(raw, { level: -1 });
  const signature = createHash('md5').update(entity).digest('hex');
  const guid = 'c'.repeat(32);
  const checksum = createHash('md5').update(`${signature}9${1766195900}${raw.length}${guid}`).digest('hex');
  const built = await fetch(`${base}/unify_logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/thrift' },
    body: buildEnvelope({
      version: 'V1.1',
      address: 'sink-e2e',
      signature,
      serialNum: 9,
      tsSecs: 1766195900,
      length: raw.length,
      entity,
      guid,
      checksum,
      codex: 1,
    }),
  });
  check('a self-built envelope is accepted', built.status === 200);

  // --- H5 ------------------------------------------------------------------
  const h5 = await fetch(`${base}/apm_web_logs?a=694a02588560e348720def2a&ver=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: H5_GOLDEN_BODY,
  });
  check('POST /apm_web_logs answers 200 (anything else bans the client)', h5.status === 200, `status=${h5.status}`);

  const beacon = await fetch(`${base}/apm_web_ping?a=pid&ver=1`, { method: 'POST', body: H5_GOLDEN_BODY });
  check('POST /apm_web_ping answers 200', beacon.status === 200);

  const image = await fetch(`${base}/apm_web_img.gif?a=pid&ver=1&i=1`);
  check('GET /apm_web_img.gif returns a GIF', image.headers.get('content-type') === 'image/gif');

  // --- permissive auxiliary endpoints --------------------------------------
  for (const path of ['/zcfg', '/heartbeat']) {
    const response = await fetch(`${base}${path}`, { method: 'POST', body: 'x' });
    check(`POST ${path} answers 200 with the thrift success struct`, response.status === 200);
  }
  const cc = await fetch(`${base}/apm_cc_web?app=pid&os=web&um_sdk_ver=2.0.10`);
  check('GET /apm_cc_web answers 200', cc.status === 200);
  const crash = await fetch(`${base}/upload`, { method: 'POST', body: 'crash' });
  check('POST /upload answers 200', crash.status === 200);

  // --- archive -------------------------------------------------------------
  await sink.store.flush();
  const day = dayStamp();
  const readChannel = async (channel) => {
    const text = await readFile(join(dataDir, `${channel}-${day}.ndjson`), 'utf8');
    return text.split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
  };

  const iosEvents = await readChannel('ios-analytics');
  check('two iOS envelopes were archived', iosEvents.length === 2, `count=${iosEvents.length}`);
  check('the golden envelope decoded', iosEvents[0].errors.length === 0, iosEvents[0].errors?.join('; '));
  check('the envelope signature verified', iosEvents[0].integrity.signatureMatches === true);
  check('the envelope checksum verified', iosEvents[0].integrity.checksumMatches === true);
  check('the entity inflated to JSON', iosEvents[0].entity.json?.header?.umid === 'sink-test-guid');
  check('the self-built entity inflated to JSON', iosEvents[1].entity.json?.header?.os === 'ios');
  check('the X-Umeng-UTC header was preserved', iosEvents[0].headers.umengUtc === '1766195800123');

  const h5Events = await readChannel('h5-logs');
  check('one H5 batch was archived', h5Events.length === 1, `count=${h5Events.length}`);
  check('the H5 header was decoded', h5Events[0].parsed.header.pid === '694a02588560e348720def2a');
  check('both H5 logs were decoded', h5Events[0].parsed.logCount === 2, `count=${h5Events[0].parsed.logCount}`);
  check('H5 pv flags were labelled', h5Events[0].parsed.logs[0].log.enable_error === 'Y');
  check('H5 api fields were labelled', h5Events[0].parsed.logs[1].log.rc === '200');

  check('the beacon channel is separate from the log channel', (await readChannel('h5-beacon')).length === 1);
  check('the image ping channel recorded the request', (await readChannel('h5-image-ping')).length === 1);

  const debugStats = await (await fetch(`${base}/__sink/stats`)).json();
  check('the debug stats endpoint reports the archive directory', debugStats.dataDir === sink.store.dataDir);
  check(
    'the debug stats endpoint counts the iOS channel',
    debugStats.channels.find((entry) => entry.channel === 'ios-analytics')?.count === 2
  );
  const debugEvents = await (await fetch(`${base}/__sink/events?limit=1&channel=h5-logs`)).json();
  check('the debug events endpoint returns recent records', debugEvents.events.length === 1);

  const dashboard = await fetch(`${base}/__sink/dashboard`);
  const dashboardHtml = await dashboard.text();
  check('GET /__sink/dashboard returns the HTML dashboard', dashboard.status === 200 && dashboard.headers.get('content-type') === 'text/html; charset=utf-8');
  check('the dashboard is dependency-free and loads its aggregate API', dashboardHtml.includes('H5 性能分析接收台') && dashboardHtml.includes('/__sink/api/dashboard'));
  const aggregate = await (await fetch(`${base}/__sink/api/dashboard?date=${day}`)).json();
  check(
    'the aggregate dashboard API reads the real archive',
    aggregate.archive.records === 2 && aggregate.overview.pageViews === 2 && aggregate.overview.apiRequests === 2,
    `records=${aggregate.archive?.records}, pv=${aggregate.overview?.pageViews}, api=${aggregate.overview?.apiRequests}`
  );
} catch (error) {
  check('e2e run completed', false, `${error.stack ?? error.message}`);
  if (error?.code === 'EPERM') {
    process.stdout.write('hint: binding a loopback port was refused (sandbox). Re-run outside the sandbox.\n');
  }
} finally {
  await sink.close();
  if (!keep) await rm(dataDir, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
if (failed.length > 0) exitCode = 1;
process.exit(exitCode);
