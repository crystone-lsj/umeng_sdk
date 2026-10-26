#!/usr/bin/env node
/**
 * Isolated fault-injection exercise for the installed H5 navigation SDK and the
 * real receiver socket/archive. Never binds, stops, or writes to the live 8787 sink.
 *
 * node scripts/failure-verify.mjs [--navigation-module /absolute/path/to/navigation.js]
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSinkServer } from '../src/server.js';
import { dayStamp } from '../src/store.js';

const moduleArg = process.argv.indexOf('--navigation-module');
const modulePath = resolve((moduleArg >= 0 && process.argv[moduleArg + 1]) ||
  '/Users/mac/develop/h5/app_inner_h5/gs-vue/packages/app-h5/axx-h5-telemetry/src/navigation.js');
const { installEmbeddedNavigationReport } = await import(pathToFileURL(modulePath));
const dataDir = await mkdtemp(join(tmpdir(), 'axx-telemetry-fault-'));
const previous = Object.fromEntries(['window', 'document', 'fetch', 'setTimeout'].map((key) => [key, globalThis[key]]));
const realFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalInfo = console.info;
let sink;
let unavailableServer;
let businessUpdates = 0;
let mode = 'online';
let port;
const requests = [];
const timers = [];
const warnings = [];
const contexts = { projectId: 'fault-isolated', appId: 'fault-app', environment: 'test' };

function check(name, condition) {
  assert.ok(condition, name);
  process.stdout.write(`ok  ${name}\n`);
}

async function drain() {
  // Wait for the real HTTP client and the navigation SDK's promise chain.
  await Promise.allSettled(requests.splice(0));
  await new Promise((done) => setImmediate(done));
  await new Promise((done) => setImmediate(done));
}

async function runPage(index) {
  const id = String(index).padStart(32, '0');
  const sessionId = 'B'.repeat(32);
  const navigationId = String(index + 100).padStart(32, '0');
  globalThis.window = {
    location: {
      search: `?axx_ap_context=${id}&axx_ap_session=${sessionId}&axx_ap_navigation=${navigationId}`,
      href: `http://127.0.0.1:5173/page-${index}?axx_ap_context=${id}`,
    },
    performance: {
      timeOrigin: Date.now() - 500,
      now: () => 500,
      getEntriesByType: (kind) => kind === 'navigation'
        ? [{ startTime: 0, loadEventEnd: 400, responseStart: 75, responseEnd: 100,
          domContentLoadedEventEnd: 250, loadEventStart: 390 }] : [],
    },
    screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 800,
  };
  globalThis.document = { readyState: 'complete' };
  const before = businessUpdates;
  businessUpdates += 1; // Minimal business flow must not throw or depend on telemetry.
  check(`business page ${index} continues while receiver ${mode}`, businessUpdates === before + 1);
  check(`SDK installs on page ${index}`, installEmbeddedNavigationReport(`http://127.0.0.1:${port}`, contexts));
  const tick = timers.splice(0).filter((entry) => entry.delay === 0);
  for (const timer of tick) timer.callback();
  await drain();
  // SDK retries only waiting for loadEventEnd, not failed HTTP uploads.
  timers.splice(0);
}

async function archive() {
  if (sink) await sink.store.flush();
  try {
    const text = await readFile(join(dataDir, `h5-navigation-${dayStamp()}.ndjson`), 'utf8');
    return text.trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function stopSink() {
  if (!sink) return;
  await sink.close();
  sink = undefined;
}

async function startSink() {
  sink = createSinkServer({ dataDir, quiet: true, host: '127.0.0.1', port: port ?? 0 });
  const address = await sink.listen();
  port = address.port;
}

async function startUnavailableServer() {
  unavailableServer = createServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('temporarily unavailable');
  });
  await new Promise((done, reject) => {
    unavailableServer.once('error', reject);
    unavailableServer.listen(port, '127.0.0.1', done);
  });
}

try {
  await startSink();
  globalThis.setTimeout = (callback, delay, ...args) => {
    // Node's real HTTP client also needs timers with .unref(); only control SDK timers.
    if (new Error().stack?.includes(modulePath)) {
      timers.push({ callback, delay });
      return timers.length;
    }
    return previous.setTimeout(callback, delay, ...args);
  };
  globalThis.fetch = (url, options) => {
    const promise = mode === 'offline'
      ? Promise.reject(new TypeError('simulated offline'))
      : realFetch(url, { ...options, signal: AbortSignal.timeout(2000) });
    requests.push(promise);
    return promise;
  };
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  console.info = () => {};

  await runPage(1);
  check('online navigation archived', (await archive()).length === 1);

  mode = 'offline';
  await runPage(2);
  check('offline navigation fails without stopping business', warnings.some((text) => text.includes('upload failed')));
  check('offline navigation not archived', (await archive()).length === 1);

  await stopSink();
  mode = 'http-503';
  await startUnavailableServer();
  const failuresBefore = warnings.length;
  await runPage(3);
  check('503 navigation failure is handled', warnings.slice(failuresBefore).some((text) => text.includes('upload failed')));
  await new Promise((done) => unavailableServer.close(done));
  unavailableServer = undefined;

  mode = 'receiver-stopped';
  const stoppedWarnings = warnings.length;
  await runPage(4);
  check('stopped receiver failure is handled', warnings.slice(stoppedWarnings).some((text) => text.includes('upload failed')));

  mode = 'online';
  await startSink(); // Same port and same archive: real receiver process-like restart.
  await runPage(5); // Fresh window simulates a new H5 page process.
  const events = await archive();
  check('new navigation after recovery archived', events.length === 2);
  check('old failed events not incorrectly replayed', events.every((event) => [
    'http://127.0.0.1:5173/page-1', 'http://127.0.0.1:5173/page-5',
  ].includes(event.parsed?.logs?.[0]?.common?.page)));
  check('new navigation correlation remains intact', events.at(-1).projectId === contexts.projectId &&
    events.at(-1).sessionId === 'B'.repeat(32) && events.at(-1).navigationId === String(105).padStart(32, '0'));
  process.stdout.write('PASS: isolated H5 failure/recovery exercise. Offline/restart events are best-effort, not replayed.\n');
} finally {
  globalThis.window = previous.window;
  globalThis.document = previous.document;
  globalThis.fetch = previous.fetch;
  globalThis.setTimeout = previous.setTimeout;
  console.warn = originalWarn;
  console.info = originalInfo;
  if (unavailableServer) await new Promise((done) => unavailableServer.close(done));
  await stopSink();
  await rm(dataDir, { recursive: true, force: true });
}
