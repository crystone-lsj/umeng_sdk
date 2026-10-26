/**
 * `@umengfe/apm` 2.0.11 browser wire format.
 *
 * Transport (verified in dist/esm/uapm.esm.js):
 *   POST {dsn}/apm_web_logs?a=<pid>&ver=1[&dc=1][&dc-args=<uri json>]
 *        Content-Type: text/plain, timeout 6000, withCredentials false
 *   POST {dsn}/apm_web_ping?...   (navigator.sendBeacon, same body)
 *   GET  {dsn}/apm_web_img.gif?...
 *   GET  {dsn}/apm_cc_web?app=&os=web&um_sdk_ver=2.0.10
 *   default dsn: https://errlog.umeng.com
 *
 * Body: `<header>|^|<log1>,<log2>,...`, every field URI-encoded, `-` = absent.
 *
 * Two log schemas exist in the same bundle:
 *  - `cn()`/`an()` (batch path, char offset ~13319):
 *      header: js_ver|pid|sid|uid|puid|tag|release|environment|cna
 *      log:    t|page|times|sampling|pv_id|ct|sr|vp|auto|ctime|cusp |$| <type fields>
 *  - `Nn()` with the `An` template map (char offset ~19321):
 *      log:    t|js_ver|page|times|sampling|pid|sid|uid|pv_id|tag|release|environment|ct|sr|vp|auto|ctime |$| <type fields>
 *
 * The receiver keeps positional fields and additionally labels them when the
 * schema is recognised, so unknown future field orders degrade to raw arrays
 * instead of being silently mislabelled.
 *
 * Required response: HTTP 200. The SDK maps 405 -> 10 minute block,
 * 406 -> 1 year block, 419 -> decryption error (char offset ~8933).
 */

export const H5_DEFAULT_DSN = 'https://errlog.umeng.com';

export const H5_HEADER_SCHEMA_V1 = Object.freeze([
  'js_ver',
  'pid',
  'sid',
  'uid',
  'puid',
  'tag',
  'release',
  'environment',
  'cna',
]);

export const H5_COMMON_SCHEMA_V1 = Object.freeze([
  't',
  'page',
  'times',
  'sampling',
  'pv_id',
  'ct',
  'sr',
  'vp',
  'auto',
  'ctime',
  'cusp',
]);

export const H5_COMMON_SCHEMA_V2 = Object.freeze([
  't',
  'js_ver',
  'page',
  'times',
  'sampling',
  'pid',
  'sid',
  'uid',
  'pv_id',
  'tag',
  'release',
  'environment',
  'ct',
  'sr',
  'vp',
  'auto',
  'ctime',
]);

/**
 * Type-specific tails of the first in-bundle encoder (`an()`, template `on`):
 *
 *   on={pv:"enable_api|enable_error|enable_perf|enable_blank",
 *       error:"name|msg|stack|file|line|col",
 *       api:"url|method|rt|rc|type|traceid|req_query|req_body",
 *       perf:"appcache|...|fpt|!fcp|tti|...|navtype|jump",
 *       perf_fcp:"fcp", perf_fid:"fid",
 *       blank:"blank_timeout|blank_target|blank_domready|score|screen_id",
 *       end:"error_count|page_duration"}
 *
 * `an()` walks the template positionally and writes `-` for a missing value, so
 * every slot is always present. The `!` prefix on `!fcp` is part of the wire
 * field name: the encoder looks up `log["!fcp"]`, which the client never sets,
 * so the slot is always `-` in practice and first-contentful-paint travels in
 * its own `perf_fcp` log. The name is preserved verbatim rather than renamed.
 */
export const H5_LOG_SCHEMA = Object.freeze({
  pv: ['enable_api', 'enable_error', 'enable_perf', 'enable_blank'],
  error: ['name', 'msg', 'stack', 'file', 'line', 'col'],
  api: ['url', 'method', 'rt', 'rc', 'type', 'traceid', 'req_query', 'req_body'],
  perf: [
    'appcache',
    'dns',
    'tcp',
    'ssl',
    'ttfb',
    'trans',
    'dom',
    'res',
    'firstbyte',
    'fpt',
    '!fcp',
    'tti',
    'ready',
    'load',
    'total',
    'unload',
    'redirect',
    'begin',
    'navtype',
    'jump',
  ],
  perf_fcp: ['fcp'],
  perf_fid: ['fid'],
  blank: ['blank_timeout', 'blank_target', 'blank_domready', 'score', 'screen_id'],
  end: ['error_count', 'page_duration'],
});

/**
 * Second in-bundle encoder (`Nn()`, template `An`). It is only defined for
 * `perf` and `error` and always emits every template slot (`-` when absent), so
 * its tails are shorter than the v1 ones and have no `jump`/`!fcp` slots:
 *
 *   An={perf: jn+"|$|appcache|...|fpt|fcp|tti|...|navtype",
 *       error: jn+"|$|msg|stack|file|line|col"}
 *
 * The common prefix is already emitted by both schemas, so the `$` tail holds
 * the type fields only.
 */
export const H5_LOG_SCHEMA_V2 = Object.freeze({
  perf: [
    'appcache',
    'dns',
    'tcp',
    'ssl',
    'ttfb',
    'trans',
    'dom',
    'res',
    'firstbyte',
    'fpt',
    'fcp',
    'tti',
    'ready',
    'load',
    'total',
    'unload',
    'redirect',
    'begin',
    'navtype',
  ],
  error: ['msg', 'stack', 'file', 'line', 'col'],
});

export const H5_BODY_SEPARATOR = '|^|';
export const MISSING = '-';

function decodeField(raw) {
  if (raw === undefined || raw === null || raw === MISSING || raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // Preserve the raw value rather than dropping evidence.
    return raw;
  }
}

function zipFields(names, values, into, extra) {
  for (let index = 0; index < values.length; index += 1) {
    const name = names[index];
    if (!name) {
      extra.push(values[index]);
      continue;
    }
    into[name] = values[index];
  }
}

function isVersionLike(value) {
  return typeof value === 'string' && /^\d+\.\d+(\.\d+)?$/.test(value);
}

/** Detects which of the two in-bundle log schemas a log line follows. */
export function detectCommonSchema(values) {
  if (values.length < 2) return null;
  return isVersionLike(values[1]) ? 'v2' : 'v1';
}

function parseLog(raw) {
  const parts = raw.split('|');
  const dollarAt = parts.indexOf('$');
  const commonRaw = dollarAt === -1 ? parts : parts.slice(0, dollarAt);
  const logRaw = dollarAt === -1 ? [] : parts.slice(dollarAt + 1);

  const commonValues = commonRaw.map(decodeField);
  const logValues = logRaw.map(decodeField);
  const schema = detectCommonSchema(commonValues);
  const names = schema === 'v2' ? H5_COMMON_SCHEMA_V2 : H5_COMMON_SCHEMA_V1;

  const common = {};
  const commonExtra = [];
  zipFields(names, commonValues, common, commonExtra);

  const type = common.t ?? null;
  // The two encoders carry different tails for the same type, so the label map
  // must follow the detected schema instead of falling back across schemas.
  const labelMap = schema === 'v2' ? H5_LOG_SCHEMA_V2 : H5_LOG_SCHEMA;
  const logFieldNames = labelMap[type] ?? [];
  const log = {};
  const logExtra = [];
  zipFields(logFieldNames, logValues, log, logExtra);

  return {
    type,
    schema,
    common,
    commonRaw: commonValues,
    log,
    logRaw: logValues,
    commonExtraValues: commonExtra,
    logExtraValues: logExtra,
  };
}

/**
 * Parses a report body. Returns raw + labelled views; malformed input yields
 * `ok: false` with the raw text preserved.
 */
export function parseH5Body(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '');
  const separatorAt = text.indexOf(H5_BODY_SEPARATOR);
  if (separatorAt === -1) {
    return {
      ok: false,
      error: 'missing body separator',
      raw: text,
      header: null,
      logs: [],
    };
  }

  const headerRaw = text.slice(0, separatorAt);
  const logsRaw = text.slice(separatorAt + H5_BODY_SEPARATOR.length);
  const headerValues = headerRaw.split('|').map(decodeField);
  const header = {};
  const headerExtra = [];
  zipFields(H5_HEADER_SCHEMA_V1, headerValues, header, headerExtra);

  const logs = logsRaw.length === 0 ? [] : logsRaw.split(',').map(parseLog);

  return {
    ok: true,
    raw: text,
    header: { ...header, raw: headerValues, extra: headerExtra },
    logs,
    logCount: logs.length,
  };
}

/** Extracts `dc-args` (encrypted/multi-part marker) from the request query. */
export function parseDcArgs(rawValue) {
  if (rawValue == null || rawValue === '') return null;
  try {
    return JSON.parse(rawValue);
  } catch {
    return { parseError: true, raw: String(rawValue) };
  }
}

export const H5_RESPONSE_CONTRACT = Object.freeze({
  ok: 200,
  blockTenMinutes: 405,
  blockOneYear: 406,
  decryptFailed: 419,
});
