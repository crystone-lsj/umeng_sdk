/**
 * Server-side, read-only Elasticsearch client for the Kibana data source.
 *
 * This module deliberately talks to Elasticsearch, not to Kibana's browser UI.
 * Kibana Data View ids and saved searches are presentation metadata; the
 * dashboard needs the Elasticsearch endpoint and a read-only credential at
 * runtime. Credentials are accepted from the caller and are never logged.
 */

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_PAGE_SIZE = 1000;
const INDEX_PATTERN = /^[-_a-zA-Z0-9.*?]+$/;

function trimBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('ELK base URL is required');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('ELK base URL must use http or https');
  return url.toString().replace(/\/$/, '');
}

function encodePathPart(value) {
  return encodeURIComponent(value).replace(/%2A/gi, '*').replace(/%3F/gi, '?');
}

function asSafeInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function authHeaders({ username, password, apiKey }) {
  if (apiKey) return { authorization: `ApiKey ${apiKey}` };
  if (username != null || password != null) {
    if (typeof username !== 'string' || typeof password !== 'string') throw new TypeError('ELK username and password must be provided together');
    return { authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` };
  }
  return {};
}

function escapeQueryString(value) {
  return String(value).replace(/[\\"*?\[\]{}()<>:\/]/g, '\\$&');
}

function matchPhrase(field, value) {
  return { match_phrase: { [field]: value } };
}

function rangeFilter(from, to) {
  const range = {};
  if (from != null) range.gte = from;
  if (to != null) range.lt = to;
  return Object.keys(range).length ? { range: { timestamp: range } } : null;
}

export function buildElkSearchBody({ from, to, an, ev, evs, mod, limit = 100, searchAfter = null, sourceFields } = {}) {
  const filters = [];
  const time = rangeFilter(from, to);
  if (time) filters.push(time);
  if (an) filters.push(matchPhrase('AN', String(an).slice(0, 128)));
  if (ev) filters.push(matchPhrase('EV', String(ev).slice(0, 128)));
  if (evs?.length) filters.push({ bool: { should: evs.map((value) => matchPhrase('EV', value)), minimum_should_match: 1 } });
  if (mod) filters.push(matchPhrase('MOD', String(mod).slice(0, 128)));
  const body = {
    track_total_hits: true,
    size: asSafeInt(limit, 100, 0, MAX_PAGE_SIZE),
    sort: [{ timestamp: { order: 'desc', unmapped_type: 'date' } }],
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    _source: sourceFields ?? true,
  };
  if (Array.isArray(searchAfter) && searchAfter.length) body.search_after = searchAfter.slice(0, 2);
  return body;
}

export function createElasticsearchClient({
  baseUrl,
  indexPattern = 'log-fe-*-gsl_test',
  username,
  password,
  apiKey,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  logger = () => {},
} = {}) {
  const root = trimBaseUrl(baseUrl);
  if (typeof indexPattern !== 'string' || !INDEX_PATTERN.test(indexPattern)) throw new TypeError('invalid ELK index pattern');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const headers = { accept: 'application/json', ...authHeaders({ username, password, apiKey }) };

  async function request(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${root}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { ...headers, ...(init.headers ?? {}) },
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      if (!response.ok) {
        const error = new Error(`ELK request failed with HTTP ${response.status}`);
        error.code = 'ELK_HTTP_ERROR';
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error('ELK read timeout');
        timeout.code = 'ELK_TIMEOUT';
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    indexPattern,
    async search(options = {}) {
      const body = buildElkSearchBody(options);
      return request(`/${encodePathPart(indexPattern)}/_search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    async scanWindow({ from, to, an, mod, evs, maxRecords = 20000 }) {
      const fields = ['AN', 'AV', 'OT', 'OV', 'UNAME', 'PHONE', 'MOD', 'EV', 'timestamp', 'eventId', 'eventType', 'route', 'contextId',
        'sessionId', 'navigationId', 'clientAt', 'totalMs', 'dnsMs', 'tcpMs', 'ttfbMs',
        'domReadyMs', 'loadEventMs', 'fpMs', 'fcpMs', 'ttiMs', 'fidMs', 'errorType', 'stage', 'reasonCode',
        'message', 'resourceType', 'httpStatus', 'environment', 'h5Release', 'apiHost', 'apiPath',
        'durationMs', 'projectId', 'deviceModel', 'osName', 'osVersion', 'appVersion',
        'bundleIdentifier', 'networkType', 'carrier', 'country', 'timezone', 'trigger',
        'residentMemoryBytes', 'memoryWarningCount', 'periodStart', 'periodEnd', 'crashes', 'hangs', 'DTL'];
      const records = [];
      async function read(start, end) {
        const result = await request(`/${encodePathPart(indexPattern)}/_search`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildElkSearchBody({ from: start, to: end, an, mod, evs,
            limit: MAX_PAGE_SIZE, sourceFields: fields })),
        });
        const total = normalizeElkTotal(result?.hits?.total);
        if (result?.hits?.total?.relation === 'gte' || !Array.isArray(result?.hits?.hits)) throw new Error('ELK_INCOMPLETE');
        if (records.length + total > maxRecords) throw new Error('ELK_TOO_MANY_RECORDS');
        if (total <= MAX_PAGE_SIZE) {
          if (result.hits.hits.length !== total) throw new Error('ELK_INCOMPLETE');
          records.push(...result.hits.hits.map((hit) => hit._source));
          return;
        }
        const middle = Math.floor((Date.parse(start) + Date.parse(end)) / 2);
        if (middle <= Date.parse(start) || middle >= Date.parse(end)) throw new Error('ELK_TOO_MANY_RECORDS');
        await read(start, new Date(middle).toISOString());
        await read(new Date(middle).toISOString(), end);
      }
      await read(from, to);
      return records;
    },
    async listApps({ from, to, mod }) {
      const body = buildElkSearchBody({ from, to, mod, limit: 0, sourceFields: false });
      body.aggs = { apps: { terms: { field: 'AN.keyword', size: 100 } } };
      const result = await request(`/${encodePathPart(indexPattern)}/_search`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      return (result.aggregations?.apps?.buckets ?? []).map((bucket) => bucket.key)
        .filter((name) => typeof name === 'string' && name.length > 0 && name.length <= 128);
    },
    async fieldCaps() {
      return request(`/${encodePathPart(indexPattern)}/_field_caps?fields=*`);
    },
    async status() {
      const result = await this.search({ limit: 0 });
      return {
        ok: true,
        indexPattern,
        total: result?.hits?.total ?? 0,
        tookMs: result?.took ?? null,
      };
    },
    // Kept for diagnostics without exposing the endpoint or auth material.
    describe() { return { configured: true, indexPattern, timeoutMs }; },
    logError(error) { logger(`[umeng-sink] ELK read failed: ${error?.code ?? 'ELK_ERROR'}`); },
  };
}

export function normalizeElkTotal(total) {
  if (typeof total === 'number') return total;
  if (total && typeof total.value === 'number') return total.value;
  return 0;
}

/** Remove direct identifiers and query-bearing URLs before returning data to a browser. */
export function projectElkSource(source) {
  const allowed = [
    'RV', 'SAV', 'LV', 'DP', 'DV', 'AID', 'timestamp', 'SDT', 'MOD', 'SDV', 'OT', 'LID', 'RID',
    'AN', 'AV', 'RO', 'EV', 'DESC', 'method', 'url', 'status', 'DTL', 'params',
    'schema', 'eventId', 'eventType', 'source', 'projectId', 'appId', 'environment',
    'contextId', 'sessionId', 'navigationId', 'clientTimestamp', 'occurredAt',
  ];
  const result = {};
  for (const key of allowed) {
    if (source?.[key] == null) continue;
    if (key === 'url' && typeof source[key] === 'string') {
      try { result[key] = `${new URL(source[key]).origin}${new URL(source[key]).pathname}`; }
      catch { result[key] = String(source[key]).split(/[?#]/, 1)[0]; }
    } else if (typeof source[key] === 'string') {
      result[key] = source[key].slice(0, key === 'DTL' || key === 'params' ? 4096 : 1024);
    } else if (typeof source[key] === 'number' || typeof source[key] === 'boolean') {
      result[key] = source[key];
    } else if (source[key] && typeof source[key] === 'object') {
      result[key] = JSON.stringify(source[key]).slice(0, 4096);
    }
  }
  return result;
}

export { escapeQueryString, MAX_PAGE_SIZE };
