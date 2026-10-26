/**
 * Socket-free request routing for the self-hosted Umeng receiver.
 *
 * It terminates the two client protocols this repository documents
 * (`umeng-analysis/ios-protocol.md`, `umeng-analysis/h5-protocol.md`) and can be
 * used either as a drop-in replacement domain for `[UMConfigure setDomain:]`
 * (iOS) and `init({ dsn })` (H5), or as the sink for the rewritten adapters in
 * `outputs/axx-umeng-delivery`.
 *
 * Response contracts that clients actually enforce:
 *  - iOS `/unify_logs`, `/zcfg`, `/heartbeat`: HTTP 200 and a thrift struct with
 *    `resp_code == 1` (UMBuildPayload.o `verifyResponseData:`).
 *  - H5: HTTP 200 only; 405/406 additionally impose client-side bans.
 *
 * Everything here is transport-independent: it takes an already-buffered body
 * and returns `{ status, headers, body }`, so routing can be tested without
 * binding a socket. `src/http-adapter.js` owns framing, size limits and write-out.
 */

import { buildSuccessResponse, decodeEnvelopeRequest } from './envelope.js';
import { PERF_FILTER_FIELDS } from './aggregate.js';
import { queryDashboard } from './dashboard-query.js';
import { SlsMirror } from './sls-mirror.js';
import { parseDcArgs, parseH5Body } from './h5.js';
import { renderDashboard } from './dashboard.js';
import { SinkStore } from './store.js';
import { optionalIdentity } from './identity.js';
import { normalizeElkTotal, projectElkSource } from './elastic-search-client.js';
import { queryElkDashboard } from './elk-dashboard.js';
import { recoverH5VueSource } from './h5-source-recovery.js';
import { createHash, timingSafeEqual } from 'node:crypto';

const ONE_PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;

export const DEFAULT_OPTIONS = Object.freeze({
  port: 8787,
  host: '127.0.0.1',
  basePath: '',
  dataDir: './data',
  maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
  quiet: false,
  logger: null,
  elkIndexPattern: 'log-fe-*-gsl_test',
});

const IOS_ANALYTICS_PATHS = new Set(['/unify_logs']);
const IOS_CONFIG_PATHS = new Set(['/zcfg', '/heartbeat']);
const H5_LOG_PATHS = new Set(['/apm_web_logs']);
const H5_BEACON_PATHS = new Set(['/apm_web_ping']);
const H5_REMOTE_CONFIG_PATHS = new Set(['/apm_cc_web']);
const APM_NATIVE_PATHS = new Set(['/apm_logs']);
const APM_NATIVE_CONFIG_PATHS = new Set(['/apm_cc']);
const CRASH_PATHS = new Set(['/upload', '/api/crashsdk/validate', '/api/crashsdk/logcollect']);
const ELK_ENVIRONMENTS = new Set(['test', 'online']);

const HTML = 'text/html; charset=utf-8';
const TEXT_PLAIN = 'text/plain; charset=utf-8';
const THRIFT = 'application/thrift';

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Msg-Type, X-Umeng-Sdk, Sm-Imp, X-Umeng-Utc, X-Requested-With',
  'Access-Control-Max-Age': '86400',
});

function withCorsHeaders(response) {
  return { ...response, headers: { ...response.headers, ...CORS_HEADERS } };
}

function corsPreflightResponse() {
  return {
    status: 204,
    headers: { ...CORS_HEADERS },
    body: Buffer.alloc(0),
  };
}

function jsonResponse(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify(payload), 'utf8'),
  };
}

function bodyResponse(status, contentType, body) {
  return {
    status,
    headers: { 'Content-Type': contentType },
    body: Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8'),
  };
}

/** Strips an optional deployment prefix and normalises the trailing slash. */
export function normalizePath(rawUrl, basePath = '') {
  const raw = rawUrl ?? '/';
  let pathname;
  try {
    pathname = new URL(raw, 'http://localhost').pathname;
  } catch {
    pathname = String(raw).split('?')[0];
  }
  if (basePath && basePath !== '/' && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  return pathname.length === 0 ? '/' : pathname;
}

function requestContext(request) {
  const headers = request.headers ?? {};
  return {
    method: request.method ?? 'GET',
    url: request.url ?? '/',
    headers: {
      contentType: headers['content-type'] ?? null,
      msgType: headers['msg-type'] ?? null,
      umengSdk: headers['x-umeng-sdk'] ?? null,
      smImp: headers['sm-imp'] ?? null,
      umengUtc: headers['x-umeng-utc'] ?? null,
      xRequestedWith: headers['x-requested-with'] ?? null,
      userAgent: headers['user-agent'] ?? null,
      referer: headers.referer ?? null,
    },
  };
}

/**
 * Builds the routing function plus the store it writes to.
 *
 * @returns {{ handle: (request: {method?: string, url?: string, headers?: object, body?: Buffer}) => Promise<{status: number, headers: object, body: Buffer}>, store: SinkStore, config: object, log: (message: string) => void }}
 */
export function createRequestHandler(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const elkClient = options.elkClient ?? null;
  const configuredElkClients = options.elkClients && typeof options.elkClients === 'object'
    ? options.elkClients : {};
  const elkClients = {
    test: configuredElkClients.test ?? elkClient,
    online: configuredElkClients.online ?? options.elkOnlineClient ?? null,
  };
  const dashboardSource = options.dashboardSource ?? 'local';
  const mirror = options.slsClient ? new SlsMirror(options.slsClient, {
    log: (message) => { if (!config.quiet) (config.logger ?? console.warn)(message); },
    maxPending: options.slsMaxPending,
    timeoutMs: options.slsTimeoutMs,
  }) : null;
  const store = options.store ?? new SinkStore({ dataDir: config.dataDir, mirror });
  const now = options.now ?? (() => new Date());
  const log = (message) => {
    if (config.quiet) return;
    if (typeof config.logger === 'function') config.logger(message);
    else process.stdout.write(`${message}\n`);
  };

  async function route(request) {
    const pathname = normalizePath(request.url, config.basePath);
    const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
    const context = requestContext(request);
    const body = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body ?? '');

    if (pathname === '/__sink/api/h5-source') {
      if (request.method !== 'POST') return jsonResponse(405, { error: 'POST required' });
      if (!config.sourceArchiveDir || !config.sourceAuthToken) return jsonResponse(503, { error: 'Source recovery is not configured' });
      const authorization = request.headers?.authorization;
      const expected = createHash('sha256').update(`Bearer ${config.sourceAuthToken}`).digest();
      const received = createHash('sha256').update(typeof authorization === 'string' ? authorization : '').digest();
      if (!timingSafeEqual(expected, received)) return jsonResponse(403, { error: 'Forbidden' });
      if (!/^application\/json(?:\s*;|$)/i.test(context.headers.contentType ?? '') || body.length > 4096) {
        return jsonResponse(400, { error: 'Expected a small JSON request' });
      }
      let input;
      try { input = JSON.parse(body.toString('utf8')); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return jsonResponse(400, { error: 'Invalid input' });
      return jsonResponse(200, await recoverH5VueSource(input, config.sourceArchiveDir));
    }

    if (pathname === '/__sink/health') {
      return jsonResponse(200, { ok: true, now: now().toISOString(), dataDir: store.dataDir,
        elk: elkClients.test ? elkClients.test.describe() : { configured: false },
        elkEnvironments: Object.fromEntries(Object.entries(elkClients).map(([environment, client]) => [
          environment, client ? client.describe() : { configured: false },
        ])) });
    }
    if (pathname === '/__sink/events') {
      const limit = Number.parseInt(query.get('limit') ?? '50', 10);
      const channel = query.get('channel');
      return jsonResponse(200, {
        events: store.recent({ limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 50, channel }),
      });
    }
    if (pathname === '/__sink/stats') {
      return jsonResponse(200, { ...store.stats(), ...(mirror && { slsMirror: mirror.stats }) });
    }
    const selectElkEnvironment = (params) => {
      const environment = params.get('environment') ?? params.get('elkEnvironment') ?? 'test';
      if (!ELK_ENVIRONMENTS.has(environment)) {
        const error = new Error('environment must be test or online');
        error.code = 'INVALID_ELK_ENVIRONMENT';
        throw error;
      }
      return environment;
    };
    const getElkClient = (params) => {
      const environment = selectElkEnvironment(params);
      return { environment, client: elkClients[environment] };
    };
    if (request.method === 'GET' && pathname === '/__sink/api/elk/status') {
      let selected;
      try { selected = getElkClient(query); } catch (error) { return jsonResponse(400, { error: error.message }); }
      const { environment, client } = selected;
      if (!client) return jsonResponse(503, { ok: false, configured: false, environment, error: 'ELK reader is not configured' });
      try {
        return jsonResponse(200, { ...await client.status(), environment });
      } catch (error) {
        client.logError?.(error);
        return jsonResponse(502, { ok: false, configured: true, error: error?.code === 'ELK_TIMEOUT' ? 'ELK read timeout' : 'ELK query unavailable' });
      }
    }
    if (request.method === 'GET' && pathname === '/__sink/api/elk/fields') {
      let selected;
      try { selected = getElkClient(query); } catch (error) { return jsonResponse(400, { error: error.message }); }
      const { environment, client } = selected;
      if (!client) return jsonResponse(503, { ok: false, configured: false, environment, error: 'ELK reader is not configured' });
      try {
        return jsonResponse(200, { environment, indexPattern: client.indexPattern, fields: await client.fieldCaps() });
      } catch (error) {
        client.logError?.(error);
        return jsonResponse(502, { ok: false, configured: true, error: error?.code === 'ELK_TIMEOUT' ? 'ELK read timeout' : 'ELK query unavailable' });
      }
    }
    if (request.method === 'GET' && pathname === '/__sink/api/elk/search') {
      let selected;
      try { selected = getElkClient(query); } catch (error) { return jsonResponse(400, { error: error.message }); }
      const { environment, client } = selected;
      if (!client) return jsonResponse(503, { ok: false, configured: false, environment, error: 'ELK reader is not configured' });
      const from = query.get('from') ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = query.get('to') ?? new Date().toISOString();
      const isUtc = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
      if (!isUtc(from) || !isUtc(to) || Date.parse(to) <= Date.parse(from)) return jsonResponse(400, { error: 'from/to must be UTC ISO timestamps with a positive interval' });
      try {
        const response = await client.search({ from, to, an: query.get('AN') ?? query.get('an'), ev: query.get('EV') ?? query.get('ev'), mod: query.get('MOD') ?? query.get('mod'), limit: query.get('limit') });
        const hits = Array.isArray(response?.hits?.hits) ? response.hits.hits : [];
        return jsonResponse(200, {
          source: 'elk', environment, indexPattern: client.indexPattern, tookMs: response?.took ?? null,
          total: normalizeElkTotal(response?.hits?.total),
          hits: hits.map((hit) => ({ id: hit?._id ?? null, index: hit?._index ?? null, sort: hit?.sort ?? null, source: projectElkSource(hit?._source) })),
        });
      } catch (error) {
        client.logError?.(error);
        return jsonResponse(502, { ok: false, configured: true, error: error?.code === 'ELK_TIMEOUT' ? 'ELK read timeout' : 'ELK query unavailable' });
      }
    }
    if (request.method === 'POST' && pathname === '/__sink/api/ios-context') {
      let context;
      try {
        context = JSON.parse(body.toString('utf8'));
      } catch {
        return jsonResponse(400, { error: 'body must be a JSON object' });
      }
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return jsonResponse(400, { error: 'body must be a JSON object' });
      }
      if (typeof context.schema !== 'string' || context.schema.length === 0) {
        return jsonResponse(400, { error: 'schema is required' });
      }
      if (typeof context.contextId !== 'string' || context.contextId.length < 8) {
        return jsonResponse(400, { error: 'contextId must contain at least 8 characters' });
      }
      if (context.contextId.length > 256) {
        return jsonResponse(400, { error: 'contextId must be at most 256 characters' });
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(context.contextId)) {
        return jsonResponse(400, { error: 'contextId contains invalid characters' });
      }
      const checked = optionalIdentity(context);
      if (checked.error) return jsonResponse(400, { error: checked.error });
      const event = store.write('ios-context', { context }, null);
      return jsonResponse(200, { ok: true, contextId: context.contextId, receivedAt: event.receivedAt });
    }

    if (request.method === 'POST' && pathname === '/__sink/api/h5-navigation') {
      let report;
      try {
        report = JSON.parse(body.toString('utf8'));
      } catch {
        return jsonResponse(400, { error: 'body must be JSON' });
      }
      if (!report || typeof report !== 'object' || Array.isArray(report) || report.schema !== 'h5-navigation-v1' ||
          !/^[a-zA-Z0-9]{32}$/.test(report.uid ?? '') ||
          typeof report.page !== 'string' || report.page.length > 2048 ||
          !/^https?:$/.test((() => { try { return new URL(report.page).protocol; } catch { return ''; } })()) ||
          !report.metrics || typeof report.metrics !== 'object' || Array.isArray(report.metrics)) {
        return jsonResponse(400, { error: 'invalid navigation identity or payload' });
      }
      const numericFields = [
        'unload', 'redirect', 'appcache', 'dns', 'tcp', 'ssl', 'ttfb', 'trans',
        'dom', 'load', 'res', 'firstbyte', 'ready', 'total', 'fpt', 'fcp', 'tti',
      ];
      const metrics = {};
      for (const key of numericFields) {
        const value = report.metrics[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600000) {
          return jsonResponse(400, { error: `invalid navigation metric: ${key}` });
        }
        metrics[key] = Math.round(value);
      }
      if (!Number.isFinite(metrics.total) || metrics.total <= 0) {
        return jsonResponse(400, { error: 'a positive total is required' });
      }
      if (report.clientAt != null && (!Number.isSafeInteger(report.clientAt) || report.clientAt <= 0)) {
        return jsonResponse(400, { error: 'clientAt must be a positive epoch millisecond integer' });
      }
      const checked = optionalIdentity(report, { navigation: true });
      if (checked.error) return jsonResponse(400, { error: checked.error });
      const identity = checked.identity;
      const optionalSize = (value) => typeof value === 'string' && /^\d{1,5}x\d{1,5}$/.test(value) ? value : null;
      const parsed = {
        header: { ...(identity.projectId ? { pid: identity.projectId } : {}),
          uid: report.uid, ...(identity.sessionId ? { sid: identity.sessionId } : {}) },
        logs: [{ type: 'perf', common: {
          page: report.page,
          sr: optionalSize(report.screenSize),
          vp: optionalSize(report.viewport),
          // Keep optional observed clientAt separate; never label receipt as ctime.
        }, log: metrics }],
        logCount: 1,
      };
      // Own parsed representation, not an official SDK wire-format claim.
      // Avoid retaining unvalidated extra JSON (including query-bearing URLs) in rawBody.
      const event = store.write('h5-navigation', { ...context, schema: report.schema,
        clientAt: report.clientAt ?? null, ...identity, parsed, source: 'embedded-navigation-timing' }, null);
      return jsonResponse(200, { ok: true, receivedAt: event.receivedAt });
    }

    if (['GET', 'POST'].includes(request.method) && pathname === '/__sink/api/dashboard') {
      if (request.method === 'POST' && !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(context.headers.contentType ?? '')) {
        return jsonResponse(415, { error: 'expected form-encoded dashboard query' });
      }
      const params = request.method === 'POST' ? new URLSearchParams(body.toString('utf8')) : query;
      const date = params.get('date');
      const from = params.get('from');
      const to = params.get('to');
      const slowThresholdMs = params.get('slowThresholdMs');
      const timeField = params.get('timeField') ?? undefined;
      const pageFilter = params.get('pageFilter') ?? '';
      const pageHost = params.get('pageHost') ?? '';
      let elkEnvironment = 'test';
      if (dashboardSource === 'elk') {
        try { elkEnvironment = selectElkEnvironment(params); } catch (error) { return jsonResponse(400, { error: error.message }); }
      }
      const performanceFilters = Object.fromEntries(PERF_FILTER_FIELDS.filter((field) => params.has('dim.' + field)).map((field) => [field, params.get('dim.' + field)]));
      if ([...params.keys()].some((key) => key.startsWith('dim.') && !PERF_FILTER_FIELDS.includes(key.slice(4)))) return jsonResponse(400, { error: 'unknown performance dimension' });
      try {
        const dashboardOptions = {
          dataDir: store.dataDir,
          date,
          from,
          to,
          timeField,
          pageFilter,
          pageHost,
          performanceFilters,
          slowThresholdMs: slowThresholdMs == null ? undefined : Number(slowThresholdMs),
        };
        if (dashboardSource === 'elk') {
          const selectedElkClient = elkClients[elkEnvironment];
          if (!selectedElkClient) return jsonResponse(503, { error: 'ELK reader is not configured', environment: elkEnvironment });
          try {
            return jsonResponse(200, await queryElkDashboard(dashboardOptions, selectedElkClient, {
              appName: options.elkAppName ?? '学什么', now,
              sourceArchiveDir: config.sourceArchiveDir,
              environment: elkEnvironment,
            }));
          } catch (error) {
            if (['INVALID_PERFORMANCE_FILTER', 'INVALID_PAGE_FILTER', 'INVALID_TIME_FIELD', 'INVALID_RANGE', 'INVALID_DATE', 'INVALID_SLOW_THRESHOLD'].includes(error?.code)) throw error;
            selectedElkClient.logError?.(error);
            return jsonResponse(502, { error: error?.message === 'ELK_TOO_MANY_RECORDS'
              ? 'Too many ELK records; narrow the time range' : 'ELK dashboard query unavailable' });
          }
        }
        return jsonResponse(200, await queryDashboard(dashboardOptions, mirror, log));
      } catch (error) {
        if (error?.code === 'INVALID_PERFORMANCE_FILTER') return jsonResponse(400, { error: error.message });
        if (error?.code === 'INVALID_PAGE_FILTER') return jsonResponse(400, { error: error.message });
        if (error?.code === 'INVALID_TIME_FIELD') return jsonResponse(400, { error: error.message });
        if (error?.code === 'INVALID_RANGE') return jsonResponse(400, { error: error.message });
        if (error?.code === 'INVALID_DATE') return jsonResponse(400, { error: 'date must be YYYY-MM-DD' });
        if (error?.code === 'INVALID_SLOW_THRESHOLD') return jsonResponse(400, { error: error.message });
        throw error;
      }
    }
    if (request.method === 'GET' && (pathname === '/' || pathname === '/__sink/dashboard')) {
      return bodyResponse(200, HTML, renderDashboard(config.basePath));
    }

    if (request.method === 'GET' && pathname === '/apm_web_img.gif') {
      store.write('h5-image-ping', { ...context, query: Object.fromEntries(query) }, null);
      return bodyResponse(200, 'image/gif', ONE_PIXEL_GIF);
    }

    if (H5_REMOTE_CONFIG_PATHS.has(pathname) || APM_NATIVE_CONFIG_PATHS.has(pathname)) {
      store.write(APM_NATIVE_CONFIG_PATHS.has(pathname) ? 'ios-apm-config' : 'h5-remote-config', {
        ...context,
        query: Object.fromEntries(query),
      });
      // Empty cloud-control payload: clients fall back to local defaults.
      return jsonResponse(200, {});
    }

    if (CRASH_PATHS.has(pathname)) {
      store.write('ios-apm-crash', { ...context, query: Object.fromEntries(query), bodyBytes: body.length }, body);
      return jsonResponse(200, { code: 0, msg: 'ok' });
    }

    if (IOS_CONFIG_PATHS.has(pathname)) {
      store.write('ios-config', { ...context, query: Object.fromEntries(query), bodyBytes: body.length }, body);
      return bodyResponse(200, THRIFT, buildSuccessResponse());
    }

    if (IOS_ANALYTICS_PATHS.has(pathname)) {
      const decoded = decodeEnvelopeRequest(body, { maxEntityBytes: config.maxBodyBytes });
      const record = {
        ...context,
        bytes: body.length,
        envelope: decoded.envelope,
        errors: decoded.errors,
        integrity: decoded.integrity,
        entity: decoded.entity
          ? { ok: decoded.entity.ok, error: decoded.entity.error ?? null, json: decoded.entity.json }
          : null,
      };
      if (decoded.entity?.ok && decoded.entity.json == null) {
        record.entityText = decoded.entity.text;
      }
      store.write('ios-analytics', record, body);
      if (!decoded.ok) log(`[umeng-sink] /unify_logs decode issues: ${decoded.errors.join('; ')}`);
      // The native client only proceeds when resp_code == 1.
      return bodyResponse(200, THRIFT, buildSuccessResponse());
    }

    if (H5_LOG_PATHS.has(pathname) || H5_BEACON_PATHS.has(pathname)) {
      const parsed = parseH5Body(body);
      const dcArgs = parseDcArgs(query.get('dc-args'));
      store.write(
        H5_LOG_PATHS.has(pathname) ? 'h5-logs' : 'h5-beacon',
        {
          ...context,
          query: Object.fromEntries(query),
          bytes: body.length,
          dcArgs,
          parsed: parsed.ok
            ? { header: parsed.header, logs: parsed.logs, logCount: parsed.logCount }
            : { error: parsed.error },
        },
        parsed.ok ? null : body
      );
      // Anything other than 200 triggers a client-side ban (405 -> 10 min, 406 -> 1 year).
      return bodyResponse(200, TEXT_PLAIN, '');
    }

    if (pathname === '/apm_img_upload') {
      store.write('h5-screenshot', { ...context, query: Object.fromEntries(query), bytes: body.length }, body);
      return bodyResponse(200, TEXT_PLAIN, '');
    }

    if (APM_NATIVE_PATHS.has(pathname)) {
      store.write('ios-apm-logs', { ...context, query: Object.fromEntries(query), bytes: body.length }, body);
      return jsonResponse(200, { code: 0, msg: 'ok' });
    }

    store.write('unknown', { ...context, path: pathname });
    return bodyResponse(404, TEXT_PLAIN, 'not found');
  }

  async function handle(request = {}) {
    const pathname = normalizePath(request.url, config.basePath);
    if (pathname === '/__sink/api/h5-source') {
      return route(request);
    }
    if (request.method === 'OPTIONS') return corsPreflightResponse();
    return withCorsHeaders(await route(request));
  }

  return { handle, store, mirror, elkClient, elkClients, config, log, now };
}
