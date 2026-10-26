/**
 * Server-only SLS boundary. `client` must implement put(event) and
 * readDay(channel, UTCday, {limit}) -> {events, complete}. readDay MUST page
 * through the entire UTC receive-day and set complete=false on truncated or
 * partial queries. The transport and its credentials never reach an SDK.
 *
 * SLS carries only an allowlisted dashboard projection, never rawBody,
 * headers, query parameters, request bodies, or unexamined native diagnostics.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DASHBOARD_CHANNELS } from './archive-source.js';

const MIRRORED_CHANNELS = new Set([...DASHBOARD_CHANNELS, 'ios-analytics', 'ios-apm-crash', 'ios-apm-logs',
  'ios-apm-config', 'ios-config', 'h5-image-ping', 'h5-remote-config', 'h5-screenshot']);
const MAX_DAY_EVENTS = 10000;
const MAX_PENDING = 256;
const allowed = (object, keys) => Object.fromEntries(keys.filter((key) => object?.[key] != null &&
  (typeof object[key] === 'string' || typeof object[key] === 'number' || typeof object[key] === 'boolean'))
  .map((key) => [key, object[key]]));
const bounded = (value) => typeof value === 'string' ? value.slice(0, 512) : undefined;
const cleanURL = (value) => {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return `${url.origin}${url.pathname}`.slice(0, 1024); }
  catch { return value.split(/[?#]/, 1)[0].slice(0, 1024); }
};

export function dashboardProjection(event) {
  if (!MIRRORED_CHANNELS.has(event.channel)) return null;
  const out = {
    mirrorId: event.mirrorId ?? randomUUID(), channel: event.channel, receivedAt: event.receivedAt,
    ...allowed(event, ['projectId', 'appId', 'environment', 'contextId', 'sessionId', 'navigationId', 'clientAt', 'bytes', 'bodyBytes']),
  };
  if (event.channel === 'ios-context') {
    const ctx = event.context ?? {};
    out.context = {
      ...allowed(ctx, ['contextId', 'projectId', 'sessionId', 'navigationId', 'capturedAt']),
      device: allowed(ctx.device, ['os', 'osVersion', 'model', 'modelIdentifier']),
      app: allowed(ctx.app, ['version', 'bundleIdentifier', 'channel']),
      network: allowed(ctx.network, ['type', 'carrier']),
      region: allowed(ctx.region, ['country', 'province', 'city', 'timezone']),
      native: {
        ...allowed(ctx.native, ['trigger', 'memoryWarningCount', 'residentMemoryBytes']),
        diagnostics: allowed(ctx.native?.diagnostics, ['source', 'periodStart', 'periodEnd', 'crashes', 'hangs']),
      },
    };
  } else if (DASHBOARD_CHANNELS.includes(event.channel)) {
    const header = allowed(event.parsed?.header, ['pid', 'uid', 'sid', 'release', 'environment', 'channel']);
    out.parsed = event.parsed?.error ? { error: 'parse failed' } : {
      header,
      logs: (event.parsed?.logs ?? []).map((item) => {
        const common = allowed(item.common, ['uid', 'sid', 'pid', 'ctime', 'release', 'environment', 'ct', 'sr', 'vp']);
        if (item.common?.page != null) common.page = cleanURL(item.common.page);
        const log = allowed(item.log, ['unload', 'redirect', 'appcache', 'dns', 'tcp', 'ssl', 'ttfb', 'trans', 'dom', 'load', 'res', 'firstbyte', 'ready', 'total', 'fpt', 'fcp', 'tti', 'fid', 'rt', 'rc', 'page_duration', 'name', 'line', 'col']);
        if (item.log?.url != null) log.url = cleanURL(item.log.url);
        // Error text, stack and file paths may include PII or query-bearing URLs.
        return { type: bounded(item.type), common, log };
      }),
    };
  }
  return out;
}

export class SlsMirror {
  #pending = new Set();
  #failed = 0;
  #sent = 0;
  #dropped = 0;
  constructor(client, { log = () => {}, maxPending = MAX_PENDING, timeoutMs = 5000 } = {}) {
    if (typeof client?.put !== 'function' || typeof client?.readDay !== 'function') throw new TypeError('SLS client requires put and readDay');
    this.client = client;
    this.log = log;
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
  }
  prepare(event) {
    if (MIRRORED_CHANNELS.has(event.channel)) event.mirrorId = randomUUID();
  }
  /** Local archival success is the only condition for entering the mirror. */
  enqueue(event) {
    if (this.#pending.size >= this.maxPending) {
      this.#dropped++;
      this.log('[umeng-sink] SLS mirror queue full; local archive retained');
      return;
    }
    let projected;
    try {
      projected = dashboardProjection(event);
      if (projected && Buffer.byteLength(JSON.stringify(projected)) > 256 * 1024) throw new Error('projection exceeds 256 KiB');
    } catch (error) {
      this.#failed++;
      this.log('[umeng-sink] SLS projection rejected; local archive retained');
      return;
    }
    if (!projected) return;
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('SLS write timeout')); }, this.timeoutMs);
    });
    const job = Promise.race([Promise.resolve().then(() => this.client.put(projected, { signal: controller.signal })), deadline])
      .then(() => { this.#sent++; })
      .catch((error) => {
        this.#failed++;
        this.log('[umeng-sink] SLS mirror failed; local archive retained');
      }).finally(() => { clearTimeout(timer); this.#pending.delete(job); });
    this.#pending.add(job);
  }
  get stats() { return { pending: this.#pending.size, sent: this.#sent, failed: this.#failed, dropped: this.#dropped }; }
  async flush() { await Promise.all([...this.#pending]); }

  /** Read SLS only when every local row has a mirrored id and SLS has exactly that set. */
  async archiveFor(local, dates) {
    const files = new Map();
    for (const day of dates) for (const channel of DASHBOARD_CHANNELS) {
      const current = await local.readChannelFile(channel, day);
      const rows = current.text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      if (rows.length > MAX_DAY_EVENTS) throw new Error('local day exceeds SLS comparison limit');
      if (!rows.length) {
        files.set(`${channel}-${day}`, current);
        continue;
      }
      if (rows.some((row) => !row.mirrorId)) throw new Error('historical or unmirrored local events');
      const controller = new AbortController();
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('SLS read timeout')); }, this.timeoutMs);
      });
      let answer;
      try {
        answer = await Promise.race([Promise.resolve().then(() => this.client.readDay(channel, day,
          { limit: MAX_DAY_EVENTS, signal: controller.signal })), deadline]);
      } finally { clearTimeout(timer); }
      if (answer?.complete !== true || !Array.isArray(answer.events) || answer.events.length !== rows.length) {
        throw new Error('SLS day incomplete');
      }
      const ids = new Set(rows.map((row) => row.mirrorId));
      const expected = new Map(rows.map((row) => [row.mirrorId, dashboardProjection(row)]));
      if (ids.size !== rows.length || answer.events.some((row) =>
        !ids.delete(row?.mirrorId) || row.channel !== channel || row.receivedAt?.slice(0, 10) !== day ||
        !isDeepStrictEqual(row, expected.get(row.mirrorId)))) {
        throw new Error('SLS day identity mismatch');
      }
      files.set(`${channel}-${day}`, { text: answer.events.map((row) => JSON.stringify(row)).join('\n'), missing: current.missing });
    }
    return {
      source: 'sls',
      availableDates: async () => local.availableDates(),
      readChannelFile: async (channel, day) => {
        const file = files.get(`${channel}-${day}`);
        if (!file) throw new Error('SLS query did not cover requested day');
        return file;
      },
    };
  }
}
