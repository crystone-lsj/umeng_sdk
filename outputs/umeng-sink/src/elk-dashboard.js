import { aggregateDashboard } from './aggregate.js';
import { recoverLocalH5VueSource } from './h5-source-recovery.js';

const DAY_MS = 86400000;

function detail(source) {
  if (typeof source.DTL !== 'string') return {};
  try {
    const parsed = JSON.parse(source.DTL);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function measured(value) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function safeRoute(value) {
  if (typeof value !== 'string') return '';
  try { return new URL(value, 'http://embedded.invalid').pathname; }
  catch { return value.split(/[?#]/, 1)[0]; }
}

function safeHost(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  try {
    const url = new URL(value, 'http://embedded.invalid');
    return url.hostname === 'embedded.invalid' ? '' : url.host;
  } catch { return ''; }
}

function sourceFile(value) {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? `${url.origin}${url.pathname}`.slice(0, 512) : undefined;
  } catch { return undefined; }
}

function sourcePosition(value) {
  const number = Number(value);
  return value != null && value !== '' && Number.isSafeInteger(number) && number > 0 && number <= 10000000
    ? number : undefined;
}

export function projectH5Analysis(source) {
  if (!source || source.MOD !== 'h5PageAnalysis') return null;
  const details = detail(source);
  const eventType = source.eventType ?? details.eventType;
  const kinds = { 'xsm.H5PageLoad': ['page_load', 'apm_perf', 'apm_perf_fcp', 'apm_perf_fid'],
    'xsm.H5PageError': ['page_error'], 'xsm.H5ApiRequest': ['apm_api'],
    'xsm.H5NativeContext': ['native_context'] };
  const allowed = kinds[source.EV];
  const kind = allowed?.includes(eventType) ? eventType : null;
  if (!kind) return null;
  const value = (key) => source[key] ?? details[key];
  const at = Number(source.timestamp);
  if (!Number.isSafeInteger(at) || at <= 0) return null;
  const logFilters = Object.fromEntries(['AN', 'AV', 'OT', 'OV', 'UNAME', 'PHONE', 'EV']
    .filter((field) => typeof source[field] === 'string' && source[field].length > 0 && source[field].length <= 128)
    .map((field) => [field, source[field]]));
  if (kind === 'native_context') {
    const contextId = value('contextId');
    if (typeof contextId !== 'string' || !/^[a-zA-Z0-9]{32}$/.test(contextId)) return null;
    const string = (key) => typeof value(key) === 'string' && value(key) ? value(key) : undefined;
    const context = { contextId, projectId: string('projectId'), logFilters,
      device: { model: string('deviceModel'), os: string('osName'), osVersion: string('osVersion') },
      app: { version: string('appVersion'), bundleIdentifier: string('bundleIdentifier') },
      network: { type: string('networkType'), carrier: string('carrier') },
      region: { country: string('country'), timezone: string('timezone') },
      native: { trigger: string('trigger'), residentMemoryBytes: measured(value('residentMemoryBytes')),
        memoryWarningCount: measured(value('memoryWarningCount')) } };
    if (context.native.trigger === 'metrickit_diagnostics' && string('periodStart') && string('periodEnd') &&
        measured(value('crashes')) != null && measured(value('hangs')) != null) {
      context.native.diagnostics = { source: 'MetricKit', periodStart: string('periodStart'),
        periodEnd: string('periodEnd'), crashes: measured(value('crashes')),
        hangs: measured(value('hangs')) };
    }
    return { receivedAt: new Date(at).toISOString(), channel: 'ios-context', context };
  }
  const common = {
    page: safeRoute(value('route')),
    pageHost: safeHost(value('route')),
    sid: value('sessionId'),
    ctime: measured(value('clientAt')),
    appVersion: value('appVersion') || logFilters.AV,
    // Source recovery is performed by the dashboard from its private archive.
    // Never trust release/source snippets supplied by the H5 bridge or log row.
    release: undefined,
    environment: value('environment'),
    ...logFilters,
  };
  const perf = { type: 'perf', common, log: {
      total: measured(value('totalMs')),
      dns: measured(value('dnsMs')),
      tcp: measured(value('tcpMs')),
      ttfb: measured(value('ttfbMs')),
      ready: measured(value('domReadyMs')),
      load: measured(value('loadEventMs')),
      fpt: measured(value('fpMs')),
      fcp: measured(value('fcpMs')),
      tti: measured(value('ttiMs')),
    } };
  const logs = kind === 'page_load' ? [{ type: 'pv', common, log: {} }, perf]
    : kind === 'apm_perf' ? [perf]
    : kind === 'apm_api' ? [{ type: 'api', common, log: {
    url: (typeof value('apiPath') === 'string' && value('apiPath').startsWith('/'))
      ? `${value('apiHost') ? `https://${value('apiHost')}` : ''}${safeRoute(value('apiPath'))}` : '',
    rc: measured(value('httpStatus')), rt: measured(value('durationMs')),
  } }] : kind === 'apm_perf_fcp' ? [{ type: 'perf_fcp', common, log: {
    fcp: measured(value('fcpMs')),
  } }] : kind === 'apm_perf_fid' ? [{ type: 'perf_fid', common, log: {
    fid: measured(value('fidMs')),
  } }] : [{ type: 'error', common, log: {
    name: String(value('errorType') ?? value('reasonCode') ?? 'page_error').slice(0, 128),
    message: String(value('message') ?? '').slice(0, 512),
    stage: typeof value('stage') === 'string' ? value('stage').slice(0, 128) : undefined,
    reasonCode: typeof value('reasonCode') === 'string' ? value('reasonCode').slice(0, 128) : undefined,
    resourceType: typeof value('resourceType') === 'string' ? value('resourceType').slice(0, 128) : undefined,
    httpStatus: measured(value('httpStatus')),
    file: sourceFile(value('sourceFile')),
    line: sourcePosition(value('line')),
    col: sourcePosition(value('column')),
    stack: typeof value('stack') === 'string' && value('stack').length <= 1024 &&
      value('stack').split('\n').every((frame) => /^https?:\/\/[^\s?#]+:\d+:\d+$/.test(frame))
      ? value('stack') : undefined,
    codeSnippet: undefined,
  } }];
  if (kind === 'apm_api' && (!value('apiPath') || !value('apiHost'))) return null;
  if (kind === 'apm_perf_fcp' && logs[0].log.fcp == null) return null;
  if (kind === 'apm_perf_fid' && logs[0].log.fid == null) return null;
  return {
    receivedAt: new Date(at).toISOString(), channel: 'h5-logs',
    parsed: { header: { sid: common.sid, uid: value('contextId'), pid: value('projectId') }, logs },
  };
}

async function enrichLocalH5Errors(errors, sourceArchiveDir) {
  if (!sourceArchiveDir) return;
  const cache = new Map();
  for (const error of errors) {
    const key = JSON.stringify([error.file, error.line, error.column, error.name]);
    if (!cache.has(key)) {
      cache.set(key, recoverLocalH5VueSource({ sourceFile: error.file, line: error.line,
        column: error.column, errorType: error.name }, sourceArchiveDir));
    }
    error.devSource = await cache.get(key);
  }
}

export async function queryElkDashboard(options, elkClient, { appName = '学什么', now = () => new Date(),
  sourceArchiveDir = null, environment = 'test' } = {}) {
  // Validate the public query contract before making any remote request.
  const empty = { async availableDates() { return []; }, async readChannelFile() { return { text: '', missing: true }; } };
  await aggregateDashboard({ ...options, dataDir: '.', archive: empty, includePrevious: false });
  const start = options.from ? Date.parse(options.from) : Date.parse(`${options.date ?? now().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const end = options.to ? Date.parse(options.to) : start + DAY_MS;
  const skew = DAY_MS; // Contexts from the preceding day can join today's visits.
  const selectedApp = options.performanceFilters?.AN ?? appName;
  const sources = await elkClient.scanWindow({ from: new Date(start - skew).toISOString(),
    to: new Date(end + skew).toISOString(), an: selectedApp, mod: 'h5PageAnalysis',
    evs: ['xsm.H5PageLoad', 'xsm.H5PageError', 'xsm.H5ApiRequest', 'xsm.H5NativeContext'] });
  const records = new Map();
  const seen = new Set();
  const navigationsWithFcp = new Set(sources.filter((source) => source?.EV === 'xsm.H5PageLoad' &&
    (source.eventType ?? detail(source).eventType) !== 'apm_perf_fcp' &&
    measured(source.fcpMs ?? detail(source).fcpMs) != null).map((source) =>
    source.navigationId ?? detail(source).navigationId).filter((id) => typeof id === 'string' && id.length > 0));
  sources.sort((a, b) => Number(b?.timestamp) - Number(a?.timestamp));
  for (const source of sources) {
    if (source?.EV === 'xsm.H5PageLoad' && (source.eventType ?? detail(source).eventType) === 'apm_perf_fcp' &&
        navigationsWithFcp.has(source.navigationId ?? detail(source).navigationId)) continue;
    const key = source?.eventId ?? detail(source ?? {}).eventId;
    if (key && seen.has(key)) continue;
    const record = projectH5Analysis(source);
    if (!record) continue;
    if (key) seen.add(key);
    const day = record.receivedAt.slice(0, 10);
    if (!records.has(day)) records.set(day, { 'h5-logs': [], 'ios-context': [] });
    records.get(day)[record.channel].push(JSON.stringify(record));
  }
  const archive = {
    async availableDates() { return [...records.keys()].sort(); },
    async readChannelFile(channel, day) {
      const lines = records.get(day)?.[channel];
      return { text: lines?.join('\n') ?? '', missing: !lines };
    },
  };
  const result = await aggregateDashboard({ ...options, dataDir: '.', archive, includePrevious: true });
  await enrichLocalH5Errors(result.errors, sourceArchiveDir);
  result.userPerception.activeFilters.AN = selectedApp;
  const appNames = typeof elkClient.listApps === 'function'
    ? await elkClient.listApps({ from: new Date(start).toISOString(), to: new Date(end).toISOString(), mod: 'h5PageAnalysis' }) : [];
  result.userPerception.filterOptions.AN = [...new Set([...appNames, selectedApp])].sort((a, b) => a.localeCompare(b));
  return { ...result, storage: { source: 'elk', environment, indexPattern: elkClient.indexPattern,
    sampleSemantics: 'page_load is observed loading; API and native metrics require their independent EVs' } };
}
