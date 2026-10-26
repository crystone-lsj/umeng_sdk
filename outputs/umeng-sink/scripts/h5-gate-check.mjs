#!/usr/bin/env node
/**
 * Real-bundle gate check for `@umengfe/apm` (the official H5/JS U-APM SDK).
 *
 * The unit tests and `e2e-verify.mjs` drive this repository's own code. This
 * script instead runs the *official* bundle inside a minimal browser shim and
 * counts what actually reaches the receiver, so the client-side sampling gates
 * documented in `umeng-analysis/h5-protocol.md` §2 can be observed rather than
 * inferred, and the corrected configuration in §4 can be shown to work.
 *
 * It never binds a socket: the shim's `XMLHttpRequest` feeds the receiver's
 * transport-independent router (`src/handler.js`) directly, so no port is
 * needed and a failure can only come from client-side dropping.
 *
 *   node scripts/h5-gate-check.mjs --sdk /path/to/@umengfe/apm/dist/esm/uapm.esm.js
 *
 * Scenarios (each runs in its own child process, because the bundle keeps
 * module-level sampling state that cannot be re-initialised):
 *
 *   current        the configuration injected by
 *                  `outputs/axx-umeng-delivery/h5/src/index.js` today
 *   fixed          `sampleConfig` fully opened (h5-protocol.md §4)
 *   open-default   no `sampleConfig` at all, i.e. untouched official defaults
 *   bridge-deny    corrected config, but the native bridge reports "N"
 *   bridge-allow   corrected config with a bridge that reports "Y"/100
 *   adapter-bridge the delivery adapter with a native bridge present: it must
 *                  remove the bridge and fall back to the HTTP dsn path
 */

import { execFile } from 'node:child_process';
import { writeSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createRequestHandler } from '../src/handler.js';
import { parseH5Body } from '../src/h5.js';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const SINK_ROOT = resolve(HERE, '..');

const PID = '694a02588560e348720def2a';
const SID = 'gate-check-session';

// `process._rawDebug` writes straight to stderr, so it still works after the
// scenario redirects `console.log` to capture the SDK's own messages.
const DEBUG = process.env.UMENG_H5_GATE_DEBUG === '1';
const debug = (message) => {
  if (DEBUG) process._rawDebug(`[gate] ${message}`);
};

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

/* ------------------------------------------------------------------ shim -- */

function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(String(key)) ? map.get(String(key)) : null),
    setItem: (key, value) => void map.set(String(key), String(value)),
    removeItem: (key) => void map.delete(String(key)),
    clear: () => map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    }
  };
}

function makeCanvasContext() {
  return {
    fillStyle: '#fff',
    strokeStyle: '#fff',
    font: '',
    fillRect() {},
    clearRect() {},
    strokeRect() {},
    drawImage() {},
    fillText() {},
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
    putImageData() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    toDataURL: () => 'data:,'
  };
}

function makeElement(tagName) {
  const name = String(tagName || 'div').toLowerCase();
  const element = {
    tagName: name.toUpperCase(),
    nodeName: name.toUpperCase(),
    style: {},
    attributes: {},
    children: [],
    innerHTML: '',
    innerText: '',
    textContent: '',
    id: '',
    className: '',
    src: '',
    href: '',
    complete: true,
    naturalWidth: 1,
    naturalHeight: 1,
    clientWidth: 390,
    clientHeight: 844,
    offsetWidth: 390,
    offsetHeight: 844,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null;
    },
    removeAttribute(key) {
      delete this.attributes[key];
    },
    hasAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attributes, key);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((entry) => entry !== child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 }),
    getClientRects: () => [],
    focus() {},
    blur() {},
    click() {},
    remove() {},
    insertAdjacentHTML() {},
    getContext: () => (name === 'canvas' ? makeCanvasContext() : null),
    toDataURL: () => 'data:,'
  };
  return element;
}

function looksLikeEventTarget(value) {
  return Boolean(value) && typeof value.addEventListener === 'function';
}

/**
 * Installs a minimal browser environment. Returns the handles the caller needs
 * to inspect traffic and to drive the bundle.
 */
function installBrowserShim({ handler, capture }) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const storage = makeStorage();

  Object.assign(doc, {
    title: 'gate-check',
    cookie: '',
    referrer: 'https://m.example.com/',
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    characterSet: 'UTF-8',
    documentElement: makeElement('html'),
    head: makeElement('head'),
    body: makeElement('body'),
    createElement: (tag) => makeElement(tag),
    createElementNS: (_ns, tag) => makeElement(tag),
    createTextNode: (text) => ({ textContent: String(text) }),
    createDocumentFragment: () => makeElement('fragment'),
    getElementById: () => null,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: doc.addEventListener.bind(doc),
    removeEventListener: doc.removeEventListener.bind(doc),
    dispatchEvent: doc.dispatchEvent.bind(doc),
    hasFocus: () => true,
    elementFromPoint: () => null
  });

  class ShimXMLHttpRequest {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.response = '';
      this.withCredentials = false;
      this.timeout = 0;
      this.headers = {};
      this.method = 'GET';
      this.url = '';
    }

    open(method, url) {
      this.method = String(method || 'GET').toUpperCase();
      this.url = String(url || '');
      this.readyState = 1;
    }

    setRequestHeader(key, value) {
      this.headers[String(key).toLowerCase()] = String(value);
    }

    getAllResponseHeaders() {
      return '';
    }

    abort() {}

    send(body) {
      const payload = body === undefined || body === null ? '' : String(body);
      this.readyState = 2;
      handler({
        method: this.method,
        url: this.url,
        headers: this.headers,
        body: Buffer.from(payload, 'utf8')
      })
        .then((response) => {
          const entry = {
            method: this.method,
            url: this.url,
            body: payload,
            status: response.status,
            headers: { ...this.headers }
          };
          capture.requests.push(entry);
          this.status = response.status;
          this.responseText = response.body ? response.body.toString('utf8') : '';
          this.response = this.responseText;
          this.readyState = 4;
          if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
          if (typeof this.onload === 'function') this.onload();
        })
        .catch((error) => {
          capture.requests.push({ method: this.method, url: this.url, body: payload, error: error.message });
          this.status = 0;
          this.readyState = 4;
          if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
          if (typeof this.onerror === 'function') this.onerror(error);
        });
    }
  }

  const bridge = {
    sendData(payload) {
      capture.jsb.push({
        method: 'sendData',
        payload: typeof payload === 'string' ? payload : JSON.stringify(payload)
      });
    },
    sendBeacon: () => true,
    getLaunchOptionsSync: () => JSON.stringify({ sample: 100, sampleResult: 'Y' })
  };

  const navigatorShim = {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSApp/1.0',
    appVersion: '5.0 (iPhone)',
    platform: 'iPhone',
    language: 'zh-CN',
    languages: ['zh-CN', 'zh'],
    cookieEnabled: true,
    onLine: true,
    hardwareConcurrency: 4,
    maxTouchPoints: 5,
    connection: {
      effectiveType: '4g',
      type: 'wifi',
      downlink: 10,
      rtt: 50,
      addEventListener() {},
      removeEventListener() {}
    },
    sendBeacon: (url, data) => {
      const target = String(url);
      const payload = data ? String(data) : '';
      capture.beacons.push({ url: target, body: payload });
      // Feed the receiver exactly like a browser would: the beacon body is the
      // same `header|^|logs` document that the POST channel carries.
      handler({
        method: 'POST',
        url: target,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from(payload, 'utf8')
      }).catch((error) => {
        capture.notes.push(`beacon routing failed: ${error.message}`);
      });
      return true;
    }
  };

  Object.assign(win, {
    window: win,
    self: win,
    top: win,
    parent: win,
    document: doc,
    name: '',
    closed: false,
    devicePixelRatio: 3,
    innerWidth: 390,
    innerHeight: 844,
    outerWidth: 390,
    outerHeight: 844,
    screen: { width: 390, height: 844, availWidth: 390, availHeight: 844, colorDepth: 24, pixelDepth: 24 },
    location: {
      href: 'https://m.example.com/app/index.html?from=gate-check',
      protocol: 'https:',
      host: 'm.example.com',
      hostname: 'm.example.com',
      port: '',
      pathname: '/app/index.html',
      search: '?from=gate-check',
      hash: '',
      origin: 'https://m.example.com',
      reload() {},
      replace() {},
      assign() {}
    },
    history: { length: 2, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {} },
    navigator: navigatorShim,
    localStorage: storage,
    sessionStorage: makeStorage(),
    performance: globalThis.performance,
    XMLHttpRequest: ShimXMLHttpRequest,
    Image: class ShimImage {
      constructor() {
        Object.assign(this, makeElement('img'));
      }
    },
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    dispatchEvent: win.dispatchEvent.bind(win),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    // Timers and language built-ins: browser code reaches for them through
    // `window`.`, which does not exist on Node's global object by default.
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    queueMicrotask: globalThis.queueMicrotask.bind(globalThis),
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    crypto: globalThis.crypto,
    fetch: globalThis.fetch,
    URL: globalThis.URL,
    Blob: globalThis.Blob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    JSON,
    Math,
    Date,
    Promise,
    RegExp,
    Error,
    Object,
    Array,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 16),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    requestIdleCallback: (callback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1),
    cancelIdleCallback: (handle) => clearTimeout(handle),
    alert() {},
    open: () => null,
    scrollTo() {},
    postMessage() {},
    UAPM_JSBridge: undefined,
    UAPM_JSB_CONFIG: undefined,
    __shimBridge: bridge
  });
  win.navigator = navigatorShim;
  win.performance = globalThis.performance;

  class ShimObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    static get supportedEntryTypes() {
      return [];
    }
  }
  win.MutationObserver = ShimObserver;
  win.PerformanceObserver = ShimObserver;
  win.IntersectionObserver = ShimObserver;
  win.ResizeObserver = ShimObserver;
  Object.assign(win, { MutationObserver: ShimObserver, PerformanceObserver: ShimObserver });

  const define = (key, value) => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };

  define('window', win);
  define('self', win);
  define('document', doc);
  define('location', win.location);
  define('navigator', navigatorShim);
  define('screen', win.screen);
  define('history', win.history);
  define('localStorage', storage);
  define('sessionStorage', win.sessionStorage);
  define('XMLHttpRequest', ShimXMLHttpRequest);
  define('MutationObserver', ShimObserver);
  define('PerformanceObserver', ShimObserver);
  define('IntersectionObserver', ShimObserver);
  define('ResizeObserver', ShimObserver);
  define('requestAnimationFrame', win.requestAnimationFrame);
  define('cancelAnimationFrame', win.cancelAnimationFrame);
  define('requestIdleCallback', win.requestIdleCallback);
  define('cancelIdleCallback', win.cancelIdleCallback);
  define('getComputedStyle', win.getComputedStyle);
  define('matchMedia', win.matchMedia);

  return { win, doc, storage, ShimXMLHttpRequest, bridge };
}

/* ------------------------------------------------------------ scenarios -- */

const OPEN_SAMPLE_CONFIG = {
  enable: true,
  sampleRate: 100,
  rules: {
    api: { enable: true, sampleRate: 100 },
    error: { enable: true, sampleRate: 100 },
    perf: { enable: true, sampleRate: 100 }
  }
};

/**
 * `bridge` mirrors the native-bridge surface: absent means a plain browser,
 * `deny` reproduces a `UAPM_JSB_CONFIG` whose sampleResult is "N".
 */
const APP_NAME = 'com.student.learnwhat';

const SCENARIOS = {
  current: () => ({
    sample: 1,
    sampleConfig: { enable: false, sampleRate: 1 },
    enableRemoteConfig: false,
    pkgList: [APP_NAME],
    bridge: null
  }),
  fixed: () => ({
    sampleConfig: OPEN_SAMPLE_CONFIG,
    enableRemoteConfig: false,
    pkgList: [APP_NAME],
    bridge: null
  }),
  'open-default': () => ({ pkgList: [APP_NAME], bridge: null }),
  'bridge-deny': () => ({
    sampleConfig: OPEN_SAMPLE_CONFIG,
    enableRemoteConfig: false,
    pkgList: [APP_NAME],
    bridge: { sample: 100, sampleResult: 'N', appName: APP_NAME }
  }),
  'bridge-allow': () => ({
    sampleConfig: OPEN_SAMPLE_CONFIG,
    enableRemoteConfig: false,
    pkgList: [APP_NAME],
    bridge: { sample: 100, sampleResult: 'Y', appName: APP_NAME }
  }),
  'bridge-pkg-mismatch': () => ({
    sampleConfig: OPEN_SAMPLE_CONFIG,
    enableRemoteConfig: false,
    pkgList: [APP_NAME],
    bridge: { sample: 100, sampleResult: 'Y', appName: 'com.example.other' }
  }),
  'adapter-bridge': () => ({
    useAdapter: true,
    pkgList: [APP_NAME],
    bridge: { sample: 100, sampleResult: 'N', appName: APP_NAME }
  })
};

async function runScenario(name, sdkPath, options) {
  const scenario = SCENARIOS[name]();
  const capture = { requests: [], jsb: [], beacons: [], notes: [] };
  const dataDir = await mkdtemp(join(tmpdir(), 'umeng-h5-gate-'));
  debug(`scenario=${name} dataDir=${dataDir}`);
  const { handle: handler, store } = createRequestHandler({
    dataDir,
    basePath: '',
    quiet: true,
    logger: (message) => capture.notes.push(message)
  });
  const { win, ShimXMLHttpRequest } = installBrowserShim({ handler, capture });
  debug('browser shim installed');

  if (scenario.bridge) {
    win.UAPM_JSB_CONFIG = { ...scenario.bridge };
    win.UAPM_JSBridge = win.__shimBridge;
  }

  // Errors printed by the SDK are evidence of the gate it hit, not noise.
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  const originalWarn = console.warn;
  console.warn = (...args) => logs.push(args.map(String).join(' '));

  let sdk;
  let initError = null;
  try {
    sdk = await import(pathToFileURL(sdkPath).href);
    debug(`bundle imported; exports=${Object.keys(sdk).join(',')}`);
    if (scenario.useAdapter) {
      const adapterPath = resolve(SINK_ROOT, '../axx-umeng-delivery/h5/src/index.js');
      const adapterModule = await import(pathToFileURL(adapterPath).href);
      const adapter = adapterModule.createAXXUmengSampledAdapter({ sdk });
      adapter.init({
        pid: PID,
        sid: SID,
        dsn: options.dsn,
        logLevel: 3,
        pkgList: scenario.pkgList
      });
      debug('adapter init returned');

      adapter.sendApiLog({
        url: 'https://api.example.com/v1/list',
        method: 1,
        rt: 123,
        rc: 200
      });
      adapter.captureException(new Error('gate-check boom'));
    } else {
      sdk.init({
        pid: PID,
        sid: SID,
        dsn: options.dsn,
        logLevel: 3,
        enableRemoteConfig: false,
        ...(scenario.pkgList ? { pkgList: scenario.pkgList } : {}),
        ...(scenario.sampleConfig ? { sampleConfig: scenario.sampleConfig } : {}),
        ...(scenario.sample !== undefined ? { sample: scenario.sample } : {})
      });
      debug('init returned');

      // Public event entry points: one api log and one JS error.
      sdk.sendAPILog({
        url: 'https://api.example.com/v1/list',
        method: 1,
        rt: 123,
        rc: 200
      });
      debug('sendAPILog returned');
      sdk.captureException(new Error('gate-check boom'));
      debug('captureException returned');
    }
  } catch (error) {
    initError = DEBUG ? `${error.name}: ${error.message}\n${error.stack}` : `${error.name}: ${error.message}`;
    debug(`init threw: ${initError}`);
  }

  // Let the 2s flush broker run.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, options.waitMs));
  debug(`waited ${options.waitMs}ms; xhr=${capture.requests.length} jsb=${capture.jsb.length}`);

  console.log = originalLog;
  console.warn = originalWarn;

  const stats = store.stats();
  const events = store.recent({ limit: 200 });
  debug('closing store');
  await store.close();
  debug('store closed');
  await rm(dataDir, { recursive: true, force: true });

  const logPosts = capture.requests.filter((entry) => entry.url.includes('/apm_web_logs'));
  // Parse the bodies the SDK actually produced with the receiver's own decoder,
  // so "the sink accepts real traffic" is measured rather than assumed.
  const delivered = [...logPosts.map((entry) => ({ channel: 'post', ...entry })), ...capture.beacons.map((entry) => ({ channel: 'beacon', ...entry }))]
    .map((entry) => {
      const parsed = parseH5Body(entry.body ?? '');
      return {
        channel: entry.channel,
        url: entry.url,
        status: entry.status ?? null,
        bytes: entry.body ? entry.body.length : 0,
        ok: parsed.ok,
        logCount: parsed.ok ? parsed.logCount : 0,
        types: parsed.ok ? parsed.logs.map((log) => log.type) : null,
        header: parsed.ok ? parsed.header : null,
        parseError: parsed.ok ? null : parsed.error
      };
    });
  return {
    scenario: name,
    initError,
    requests: capture.requests.map((entry) => ({
      method: entry.method,
      url: entry.url,
      status: entry.status ?? null,
      bodyLength: entry.body ? entry.body.length : 0,
      error: entry.error ?? null
    })),
    logPostCount: logPosts.length,
    beaconCount: capture.beacons.length,
    jsbCount: capture.jsb.length,
    delivered,
    channels: stats.channels,
    archived: events.map((event) => ({
      channel: event.channel,
      logCount: event.parsed?.logCount ?? null,
      types: event.parsed?.logs ? event.parsed.logs.map((log) => log.type) : null,
      parseError: event.parsed?.error ?? null
    })),
    sdkLogs: logs.filter((line) => /采样|过滤|抛弃|失败|error|Error/.test(line)).slice(0, 12)
  };
}

/* ---------------------------------------------------------------- driver -- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sdkPath = args.sdk ?? process.env.UMENG_APM_SDK;
  const waitMs = args['wait-ms'] ? Number.parseInt(args['wait-ms'], 10) : 5000;

  if (!sdkPath) {
    process.stderr.write(
      'usage: node scripts/h5-gate-check.mjs --sdk <path to @umengfe/apm/dist/esm/uapm.esm.js>\n' +
        '       (or set UMENG_APM_SDK)\n'
    );
    process.exit(2);
  }

  // Child mode: run exactly one scenario and print JSON.
  //
  // The bundle keeps module-level timers alive (`setInterval` flush loops), so
  // the loop would otherwise never drain and the parent would block in
  // `execFile` forever. Write with `fs.writeSync` so the report cannot be
  // truncated, then exit deliberately.
  if (args.child) {
    const result = await runScenario(args.scenario, sdkPath, {
      dsn: args.dsn ?? 'https://errlog.umeng.com',
      waitMs
    });
    writeSync(1, `${JSON.stringify(result)}\n`);
    process.exit(0);
  }

  const names = args.scenario && args.scenario !== 'all' ? [args.scenario] : Object.keys(SCENARIOS);
  const results = [];
  for (const name of names) {
    const childArgs = [fileURLToPath(import.meta.url), '--child', `--scenario=${name}`, `--sdk=${sdkPath}`];
    if (args.dsn) childArgs.push(`--dsn=${args.dsn}`);
    childArgs.push(`--wait-ms=${waitMs}`);
    const { stdout } = await execFileAsync(process.execPath, childArgs, { maxBuffer: 8 * 1024 * 1024 });
    const result = JSON.parse(stdout.trim().split('\n').pop());
    results.push(result);

    const expect = EXPECTATIONS[name];
    const passed = expect(result);
    process.stdout.write(
      `${passed ? 'ok  ' : 'FAIL'} ${name.padEnd(13)} logPosts=${result.logPostCount} ` +
        `beacons=${result.beaconCount} jsb=${result.jsbCount} channels=${
          result.channels.map((channel) => `${channel.channel}:${channel.count}`).join(',') || '-'
        }\n`
    );
    if (result.initError) process.stdout.write(`     init error: ${result.initError}\n`);
    for (const entry of result.requests.slice(0, 4)) {
      process.stdout.write(`     ${entry.method} ${entry.url} -> ${entry.status} (${entry.bodyLength}B)\n`);
    }
    for (const entry of result.archived.slice(0, 2)) {
      process.stdout.write(
        `     archived ${entry.channel} logCount=${entry.logCount} types=${JSON.stringify(entry.types)}${
          entry.parseError ? ` error=${entry.parseError}` : ''
        }\n`
      );
    }
    for (const line of result.sdkLogs) process.stdout.write(`     sdk: ${line}\n`);
  }

  const failed = results.filter((result) => !EXPECTATIONS[result.scenario](result));
  process.stdout.write(`\n${results.length - failed.length}/${results.length} scenarios matched expectations\n`);
  if (failed.length > 0) process.exitCode = 1;
}

/**
 * Expectations encode the documented client behaviour:
 *  - `current` drops everything client-side (`sampleConfig.enable = false`).
 *  - `fixed` delivers api + error logs to the receiver.
 *  - `open-default` keeps the official 30%/10% api+perf defaults, and its
 *    global `sampleRate: 100` still lets the event-level rules through only
 *    when their own roll succeeds, so it must *not* be treated as full capture.
 *  - `bridge-deny` hands data to the native bridge instead of HTTP, and the
 *    bridge's "N" result is what decides delivery.
 *  - `bridge-allow` hands data to the native bridge as well.
 */
const EXPECTATIONS = {
  current: (result) => result.logPostCount === 0 && result.beaconCount === 0 && result.channels.length === 0,
  fixed: (result) =>
    result.logPostCount >= 1 &&
    result.channels.some((channel) => channel.channel === 'h5-logs' && channel.count >= 1) &&
    result.archived.some((entry) => entry.logCount >= 1),
  'open-default': (result) => result.logPostCount >= 1 && result.beaconCount >= 1,
  'bridge-deny': (result) => result.jsbCount === 0 && result.logPostCount === 0 && result.beaconCount === 0,
  'bridge-allow': (result) => result.jsbCount === 0 && result.logPostCount === 0 && result.beaconCount === 0,
  'bridge-pkg-mismatch': (result) =>
    result.jsbCount === 0 && result.logPostCount === 0 && result.beaconCount === 0,
  'adapter-bridge': (result) =>
    result.logPostCount >= 1 &&
    result.jsbCount === 0 &&
    result.channels.some((channel) => channel.channel === 'h5-logs' && channel.count >= 1)
};

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
