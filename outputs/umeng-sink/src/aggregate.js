/**
 * Read-only H5 dashboard aggregation over a complete archive source.
 *
 * The source contract owns the representation: this module never mutates reports
 * and never guesses a failed parse. It groups only successfully parsed H5 logs;
 * malformed records are counted and surfaced separately.
 */

import { localArchive } from "./archive-source.js";
import { createHash } from "node:crypto";

export const PERF_FILTER_FIELDS = Object.freeze([
  "appVersion",
  "deviceModel",
  "osVersion",
  "carrier",
  "channel",
  "networkType",
  "region",
  "bundleIdentifier",
  "sdkVersion",
  "AN",
  "AV",
  "OT",
  "OV",
  "UNAME",
  "PHONE",
  "EV",
]);
const H5_CHANNELS = ["h5-logs", "h5-beacon", "h5-navigation"];
const IOS_CONTEXT_CHANNEL = "ios-context";
const CONTEXT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CLIENT_CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_COUNT = 24;
const DEFAULT_SLOW_THRESHOLD_MS = 5000;
export const MIN_SLOW_THRESHOLD_MS = 100;
export const MAX_SLOW_THRESHOLD_MS = 20000;

const PERF_STAGE_IDS = Object.freeze([
  "unload",
  "redirect",
  "appcache",
  "dns",
  "tcp",
  "ssl",
  "ttfb",
  "trans",
  "dom",
  "load",
  "res",
  "firstbyte",
  "ready",
  "total",
]);
const PERF_STAGE_LABELS = Object.freeze({
  unload: "卸载页面(Unload)",
  redirect: "重定向(Redirect)",
  appcache: "检查缓存(Appcache)",
  dns: "DNS查询",
  tcp: "TCP连接",
  ssl: "SSL建连",
  ttfb: "首字节响应时间(TTFB)",
  trans: "内容传输",
  dom: "DOM解析",
  load: "load事件时间",
  res: "资源加载",
  firstbyte: "首字节",
  ready: "DOM Ready",
  total: "页面完全加载",
});
const DIMENSION_FIELDS = Object.freeze({
  screenSize: "sr",
  viewport: "vp",
  release: "release",
  environment: "environment",
});
const IOS_CONTEXT_DIMENSION_FIELDS = Object.freeze([
  "networkType",
  "deviceModel",
  "osVersion",
  "appVersion",
  "carrier",
  "region",
]);

function emptyResult(date) {
  return {
    date,
    availableDates: [],
    archive: { records: 0, malformedLines: 0, missingFiles: 0, channels: {} },
    overview: {
      pageViews: 0,
      uniqueVisitors: 0,
      sessions: 0,
      errors: 0,
      apiRequests: 0,
      apiSuccessRate: null,
      averageApiRtMs: null,
      projectIds: [],
      logTypes: {},
    },
    trend: Array.from({ length: HOUR_COUNT }, (_, hour) => ({
      hour: String(hour).padStart(2, "0"),
      pageViews: 0,
      apiRequests: 0,
      errors: 0,
      affectedVisitors: 0,
      issues: 0,
      pageCount: 0,
      metrics: {},
    })),
    pages: [],
    apis: [],
    performance: {
      fcp: { count: 0, p50: null, p75: null, p90: null },
      fid: { count: 0, p50: null, p90: null },
      pageLoad: { count: 0, p50: null, p90: null },
    },
    userPerception: {
      filterOptions: Object.fromEntries(
        PERF_FILTER_FIELDS.map((key) => [key, []]),
      ),
      activeFilters: {},
      metricOrder: [
        "ttfb",
        "tcp",
        "tti",
        "pageLoad",
        "oneSecondFastRate",
        "twoSecondFastRate",
        "fiveSecondSlowRate",
      ],
      metrics: {},
      sampleDistribution: { good: 0, fair: 0, poor: 0 },
      dimensions: {},
      metricDimensions: {},
      contextCoverage: {
        total: 0,
        exact: 0,
        singleContextFallback: 0,
        h5NetworkOnly: 0,
        none: 0,
        contexts: 0,
      },
      navigationFallbackSamples: 0,
      missingMilestoneSamples: 0,
      navigationMissingMilestoneSamples: 0,
      pageOptions: [],
      pages: [],
    },
    loadingPerformance: {
      stageOrder: PERF_STAGE_IDS,
      stages: {},
      pages: [],
    },
    slowLoading: {
      thresholdMs: DEFAULT_SLOW_THRESHOLD_MS,
      overview: {
        samples: 0,
        slowLoadingCount: 0,
        slowLoadingRate: null,
        affectedPages: 0,
        affectedVisitors: 0,
      },
      pages: [],
    },
    errors: [],
    errorAnalysis: {
      affectedVisitors: 0,
      pageCount: 0,
      issueCount: 0,
      latestAt: null,
      types: [],
      stages: [],
      reasons: [],
      resources: [],
      statuses: [],
      pages: [],
      versions: [],
      issues: [],
      missingReasons: 0,
    },
    native: {
      contexts: 0,
      lookbackContexts: 0,
      snapshots: 0,
      starts: 0,
      foregrounds: 0,
      backgrounds: 0,
      memoryWarnings: 0,
      networkChanges: 0,
      latestResidentMemoryBytes: null,
      latestTrigger: null,
      latestAt: null,
      latestDiagnostics: null,
      matchedPageViews: 0,
      matchedVisitors: 0,
      dimensions: {},
      linkedPageViewDimensions: {},
    },
  };
}

function isValidDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentileValue / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function average(values) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 2) {
  return value == null ? null : Number(value.toFixed(digits));
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pageKey(value) {
  if (value == null || value === "") return "(unknown page)";
  try {
    const url = new URL(String(value), "http://embedded.invalid");
    if (url.origin !== "null" && url.hostname !== "embedded.invalid") {
      return `${url.origin}${url.pathname}` || "(unknown page)";
    }
    return url.pathname || "(unknown page)";
  } catch {
    return String(value);
  }
}

function apiKey(value) {
  if (value == null || value === "") return "(unknown api)";
  try {
    const url = new URL(String(value), "http://embedded.invalid");
    if (url.origin !== "null" && url.hostname !== "embedded.invalid") {
      return `${url.origin}${url.pathname}` || "(unknown api)";
    }
    return url.pathname || "(unknown api)";
  } catch {
    return String(value);
  }
}

function clientTimestamp(record, commonLog) {
  // Historical fallback records synthesized ctime at receipt. Only the new,
  // explicitly supplied navigation completion time is a client observation.
  if (record.channel === "h5-navigation" && record.clientAt == null)
    return null;
  // The official H5 wire format carries ctime as epoch milliseconds. It is an
  // untrusted device clock: accept only events within a bounded arrival skew.
  const ctime = numberOrNull(
    record.channel === "h5-navigation" ? record.clientAt : commonLog?.ctime,
  );
  const received = Date.parse(record.receivedAt);
  return Number.isSafeInteger(ctime) &&
    Number.isFinite(received) &&
    Math.abs(ctime - received) <= CLIENT_CLOCK_TOLERANCE_MS
    ? new Date(ctime).toISOString()
    : null;
}

function timestampFor(record, commonLog) {
  return clientTimestamp(record, commonLog) ?? record.receivedAt ?? null;
}

function errorSummary(typeLog, commonLog, record, visitorId, clientVersion) {
  const name = typeLog.name ?? null;
  const message = typeLog.msg ?? typeLog.message ?? null;
  const summary = {
    at: timestampFor(record, commonLog),
    clientAt: clientTimestamp(record, commonLog),
    page: pageKey(commonLog.page),
    app: commonLog.AN ?? null,
    phone: commonLog.PHONE ?? null,
    userName: commonLog.UNAME ?? null,
    eventId: record.eventId ?? null,
    name,
    message,
    stack: typeLog.stack ?? null,
    file: typeLog.file ?? null,
    line: typeLog.line ?? null,
    column: typeLog.col ?? null,
    codeSnippet: typeLog.codeSnippet ?? null,
    visitorId,
    appVersion: clientVersion ?? commonLog.appVersion ?? null,
    // Keep the legacy field for existing dashboard consumers and archived data.
    version: clientVersion ?? commonLog.appVersion ?? null,
    channel: record.channel,
    stage:
      typeof typeLog.stage === "string" ? typeLog.stage.slice(0, 128) : null,
    reasonCode:
      typeof typeLog.reasonCode === "string"
        ? typeLog.reasonCode.slice(0, 128)
        : null,
    resourceType:
      typeof typeLog.resourceType === "string"
        ? typeLog.resourceType.slice(0, 128)
        : null,
    httpStatus: numberOrNull(typeLog.httpStatus),
  };
  summary.errorKey = createHash("sha256")
    .update(
      JSON.stringify([
        summary.app,
        summary.page,
        summary.name,
        summary.message,
        summary.reasonCode,
        summary.resourceType,
        summary.file,
        summary.line,
        summary.column,
      ]),
    )
    .digest("hex");
  return summary;
}

function compareVersionLabels(left, right) {
  const parse = (value) =>
    String(value)
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av === bv) continue;
    if (typeof av === "number" && typeof bv === "number") return av - bv;
    return String(av).localeCompare(String(bv));
  }
  return String(left).localeCompare(String(right));
}

function formatVersionRange(versions) {
  const sorted = [...versions].sort(compareVersionLabels);
  if (sorted.length === 0) return "未上报";
  if (sorted.length === 1) return sorted[0];
  const semverLike = sorted.every((value) =>
    /^v?\d+(?:\.\d+){0,3}(?:[-+].*)?$/i.test(value),
  );
  return semverLike ? `${sorted[0]} ~ ${sorted.at(-1)}` : sorted.join("、");
}

function addErrorGroup(groups, key, at) {
  const entry = groups.get(key) ?? { count: 0, lastAt: null };
  entry.count += 1;
  if (at && (!entry.lastAt || at > entry.lastAt)) entry.lastAt = at;
  groups.set(key, entry);
}

function updateIssueDetails(details, issueKey, summary) {
  const entry = details.get(issueKey) ?? {
    firstAt: null,
    firstVersion: null,
    lastAt: null,
    lastVersion: null,
    versions: new Set(),
  };
  if (summary.version != null && summary.version !== "")
    entry.versions.add(String(summary.version));
  if (
    entry.firstAt == null ||
    (summary.at != null && summary.at < entry.firstAt)
  ) {
    entry.firstAt = summary.at;
    entry.firstVersion = summary.version || null;
  }
  if (
    entry.lastAt == null ||
    (summary.at != null && summary.at > entry.lastAt)
  ) {
    entry.lastAt = summary.at;
    entry.lastVersion = summary.version || null;
  }
  details.set(issueKey, entry);
}

function topErrorGroups(groups, total, limit = 10) {
  return [...groups]
    .map(([value, entry]) => ({
      value,
      count: entry.count,
      rate: total ? round((entry.count / total) * 100) : null,
      lastAt: entry.lastAt,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function metricStore() {
  return {
    fp: [],
    fcp: [],
    tti: [],
    fid: [],
    pageLoad: [],
    ...Object.fromEntries(PERF_STAGE_IDS.map((id) => [id, []])),
  };
}

function ensurePage(pages, key) {
  let page = pages.get(key);
  if (!page) {
    page = {
      page: key,
      pageHosts: new Set(),
      pageViews: 0,
      uniqueVisitors: new Set(),
      errors: 0,
      apiRequests: 0,
      apiErrors: 0,
      apiRtValues: [],
      durationValues: [],
      // Keep the duration and its measured milestones together. Slow URL rows
      // must aggregate only the slow navigation samples, not unrelated visits.
      openSamples: [],
      metrics: metricStore(),
      lastPerfAt: null,
    };
    pages.set(key, page);
  }
  return page;
}

function ensureApi(apis, key) {
  let api = apis.get(key);
  if (!api) {
    api = { api: key, requests: 0, errors: 0, success: 0, rtValues: [] };
    apis.set(key, api);
  }
  return api;
}

function dimensionStore() {
  const fields = [
    ...Object.keys(DIMENSION_FIELDS),
    ...IOS_CONTEXT_DIMENSION_FIELDS,
  ];
  return Object.fromEntries(fields.map((key) => [key, new Map()]));
}

function dimensionMetricStore() {
  return Object.fromEntries(
    IOS_CONTEXT_DIMENSION_FIELDS.map((key) => [key, new Map()]),
  );
}

function iosDimensionStore() {
  return Object.fromEntries(
    IOS_CONTEXT_DIMENSION_FIELDS.map((key) => [key, new Map()]),
  );
}

function collectIosDimensions(store, context) {
  if (!context) return;
  for (const field of IOS_CONTEXT_DIMENSION_FIELDS)
    collectDimension(store, field, context[field]);
}

function hourIndex(value) {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCHours();
}

function inc(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}

function collectMetric(target, id, value) {
  if (value == null || value < 0) return;
  target.metrics[id].push(value);
}

function collectDimension(store, field, value) {
  if (value == null || value === "") return;
  const key = String(value);
  store[field].set(key, (store[field].get(key) ?? 0) + 1);
}

function latestTime(current, candidate) {
  if (candidate == null) return current;
  if (current == null) return candidate;
  return candidate > current ? candidate : current;
}

function metricSummary(values) {
  return {
    count: values.length,
    average: round(average(values)),
    p50: round(percentile(values, 50)),
    p90: round(percentile(values, 90)),
    p95: round(percentile(values, 95)),
  };
}

function ratioSummary(values, predicate) {
  const count = values.filter(predicate).length;
  return {
    count,
    sampleCount: values.length,
    rate: values.length === 0 ? null : round((count / values.length) * 100),
  };
}

function topDimensions(map, limit = 8) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({
      value,
      count,
      rate: round(
        (count / [...map.values()].reduce((sum, n) => sum + n, 0)) * 100,
      ),
    }));
}

function finalizeDimensions(store) {
  return Object.fromEntries(
    Object.entries(store).map(([field, values]) => [
      field,
      topDimensions(values),
    ]),
  );
}

function finalizePage(page) {
  const successRate =
    page.apiRequests === 0
      ? null
      : ((page.apiRequests - page.apiErrors) / page.apiRequests) * 100;
  const openValues = page.openSamples.map((sample) => sample.duration);
  return {
    page: page.page,
    pageHosts: [...page.pageHosts].sort(),
    pageViews: page.pageViews,
    uniqueVisitors: page.uniqueVisitors.size,
    errors: page.errors,
    apiRequests: page.apiRequests,
    apiSuccessRate: round(successRate),
    averageApiRtMs: round(average(page.apiRtValues)),
    averageDurationMs: round(average(page.durationValues)),
    performance: {
      sampleCount: openValues.length,
      fp: metricSummary(page.metrics.fp),
      fcp: metricSummary(page.metrics.fcp),
      tcp: metricSummary(page.metrics.tcp),
      ttfb: metricSummary(page.metrics.ttfb),
      tti: metricSummary(page.metrics.tti),
      pageLoad: metricSummary(page.metrics.pageLoad),
      oneSecondFastRate: ratioSummary(openValues, (value) => value <= 1000),
      twoSecondFastRate: ratioSummary(openValues, (value) => value <= 2000),
      fiveSecondSlowRate: ratioSummary(openValues, (value) => value > 5000),
      stages: Object.fromEntries(
        PERF_STAGE_IDS.map((id) => [id, metricSummary(page.metrics[id])]),
      ),
      lastPerfAt: page.lastPerfAt,
    },
    openSamples: page.openSamples,
  };
}

function finalizeApi(api) {
  return {
    api: api.api,
    requests: api.requests,
    errors: api.errors,
    successRate: round((api.success / api.requests) * 100),
    averageRtMs: round(average(api.rtValues)),
    p50RtMs: round(percentile(api.rtValues, 50)),
    p95RtMs: round(percentile(api.rtValues, 95)),
  };
}

function contextProjection(record) {
  const context =
    record?.context && typeof record.context === "object"
      ? record.context
      : record;
  const device =
    context?.device && typeof context.device === "object" ? context.device : {};
  const app =
    context?.app && typeof context.app === "object" ? context.app : {};
  const network =
    context?.network && typeof context.network === "object"
      ? context.network
      : {};
  const region =
    context?.region && typeof context.region === "object" ? context.region : {};
  const contextId = context?.contextId ?? context?.id;
  const projectId = context?.projectId ?? context?.project;
  if (typeof contextId !== "string" || contextId.length === 0) return null;
  const osVersion = [device.os, device.osVersion]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(" ")
    .trim();
  const regionValue = [
    region.country,
    region.province,
    region.city,
    region.timezone,
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(" / ");
  return {
    contextId,
    receivedAt: record.receivedAt ?? null,
    projectId: projectId == null ? null : String(projectId),
    deviceModel: device.model ?? device.modelIdentifier ?? null,
    modelIdentifier: device.modelIdentifier ?? null,
    osVersion: osVersion.length > 0 ? osVersion : null,
    appVersion: app.version ?? null,
    bundleIdentifier: app.bundleIdentifier ?? null,
    networkType: network.type ?? null,
    carrier: network.carrier ?? null,
    region: regionValue.length > 0 ? regionValue : null,
  };
}

function contextDimensionValues(linkedContext, commonLog) {
  return {
    deviceModel: linkedContext?.deviceModel,
    osVersion: linkedContext?.osVersion,
    appVersion: linkedContext?.appVersion ?? commonLog.release,
    networkType: linkedContext?.networkType ?? commonLog.ct,
    carrier: linkedContext?.carrier,
    region: linkedContext?.region,
  };
}

// Retain each measured milestone with its own attributed dimension value.
// A missing metric stays missing; context-only reports never become perf samples.
function collectDimensionMetrics(store, field, value, log) {
  if (value == null || value === "") return;
  const key = String(value);
  let metrics = store[field].get(key);
  if (!metrics) {
    metrics = { fp: [], fcp: [], tcp: [], ttfb: [], tti: [], pageLoad: [] };
    store[field].set(key, metrics);
  }
  for (const [id, source] of [
    ["fp", "fpt"],
    ["fcp", "fcp"],
    ["tcp", "tcp"],
    ["ttfb", "ttfb"],
    ["tti", "tti"],
    ["pageLoad", "total"],
  ]) {
    const numeric = numberOrNull(
      id === "pageLoad" ? (log.total ?? log.load) : log[source],
    );
    if (numeric != null && numeric >= 0) metrics[id].push(numeric);
  }
}

function finalizeMetricDimensions(store, countDimensions) {
  return Object.fromEntries(
    Object.entries(store).map(([field, values]) => [
      field,
      (countDimensions[field] ?? []).slice(0, 5).map(({ value, count }) => {
        const metrics = values.get(value);
        return {
          value,
          count,
          fp: metricSummary(metrics?.fp ?? []),
          fcp: metricSummary(metrics?.fcp ?? []),
          tcp: metricSummary(metrics?.tcp ?? []),
          ttfb: metricSummary(metrics?.ttfb ?? []),
          tti: metricSummary(metrics?.tti ?? []),
          pageLoad: metricSummary(metrics?.pageLoad ?? []),
          oneSecondFastRate: ratioSummary(
            metrics?.pageLoad ?? [],
            (n) => n <= 1000,
          ),
          twoSecondFastRate: ratioSummary(
            metrics?.pageLoad ?? [],
            (n) => n <= 2000,
          ),
          fiveSecondSlowRate: ratioSummary(
            metrics?.pageLoad ?? [],
            (n) => n > 5000,
          ),
        };
      }),
    ]),
  );
}

function performanceFilterValues(linkedContext, commonLog, header) {
  return {
    ...contextDimensionValues(linkedContext, commonLog),
    channel: null, // Not present in the archived H5 protocol or iOS Reporter context.
    bundleIdentifier: linkedContext?.bundleIdentifier ?? null,
    sdkVersion: commonLog.js_ver ?? header.js_ver ?? null, // H5 JS SDK, not native Umeng SDK.
    ...Object.fromEntries(
      ["AN", "AV", "OT", "OV", "UNAME", "PHONE", "EV"].map((field) => [
        field,
        commonLog[field] ?? linkedContext?.logFilters?.[field] ?? null,
      ]),
    ),
  };
}

function matchesPerformanceFilters(values, filters) {
  return Object.entries(filters).every(
    ([field, expected]) => String(values[field] ?? "") === expected,
  );
}

function normalizePageHost(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function observedPageHost(page, explicitHost = "") {
  const normalized = normalizePageHost(explicitHost);
  if (normalized) return normalized;
  try {
    const url = new URL(String(page ?? ""), "http://embedded.invalid");
    return url.hostname === "embedded.invalid"
      ? ""
      : normalizePageHost(url.host);
  } catch {
    return "";
  }
}

function matchesPageFilter(page, explicitHost, pageFilter, pageHost) {
  const normalizedPage = String(page ?? "").toLocaleLowerCase();
  if (pageFilter && !normalizedPage.includes(pageFilter.toLocaleLowerCase()))
    return false;
  if (!pageHost) return true;
  return observedPageHost(page, explicitHost) === normalizePageHost(pageHost);
}

function visitRecord(context, record) {
  const {
    result,
    pages,
    pageOptions,
    apis,
    visitors,
    sessions,
    projectIds,
    globalMetrics,
    hourlyMetrics,
    bucketIndex,
    dimensions,
    dimensionMetrics,
    errors,
    errorGroups,
    errorVisitors,
    errorTrendVisitors,
    errorTrendIssues,
    errorTrendPages,
    issueVisitors,
    issueDetails,
    filterOptions,
    performanceFilters,
    pageFilter,
    pageHost,
    resolveContext,
    hasSingleContext,
    singleContext,
    pvContextVisitors,
    pvLinkedContexts,
    timeField,
    windowStart,
    windowEnd,
    clientTimeCoverage,
  } = context;
  result.archive.records += 1;
  inc(result.archive.channels, record.channel ?? "unknown");
  const parsed = record.parsed;
  if (parsed?.error || !Array.isArray(parsed?.logs)) return;

  const header = parsed.header ?? {};
  for (const item of parsed.logs) {
    const clientAt = clientTimestamp(record, item?.common);
    if (timeField === "clientAt") {
      const time = clientAt == null ? NaN : Date.parse(clientAt);
      if (!Number.isFinite(time)) {
        clientTimeCoverage.missingOrSkewed += 1;
        continue;
      }
      if (!(time >= windowStart && time < windowEnd)) {
        clientTimeCoverage.outsideWindow += 1;
        continue;
      }
      clientTimeCoverage.valid += 1;
    }
    const type = item?.type;
    const commonLog = item?.common ?? {};
    const typeLog = item?.log ?? {};
    const visitorId = header.uid ?? commonLog.uid ?? null;
    const linked =
      visitorId == null
        ? null
        : resolveContext(String(visitorId), record.receivedAt);
    const fallbackContext =
      linked ??
      (hasSingleContext && singleContext?.receivedAt == null
        ? singleContext
        : null);
    const values = performanceFilterValues(fallbackContext, commonLog, header);
    for (const field of PERF_FILTER_FIELDS) {
      const value = values[field];
      if (value != null && value !== "")
        filterOptions[field].add(String(value));
    }
    if (!matchesPerformanceFilters(values, performanceFilters)) continue;
    const pageValue = pageKey(commonLog.page);
    if (pageValue) pageOptions.add(pageValue);
    const pageHostValue = observedPageHost(pageValue, commonLog.pageHost);
    if (!matchesPageFilter(pageValue, pageHostValue, pageFilter, pageHost))
      continue;
    inc(result.overview.logTypes, type ?? "unknown");

    const sessionId = header.sid ?? commonLog.sid ?? null;
    if (visitorId != null) visitors.add(String(visitorId));
    if (sessionId != null) sessions.add(String(sessionId));
    if (header.pid != null) projectIds.add(String(header.pid));
    if (commonLog.pid != null) projectIds.add(String(commonLog.pid));

    const page = ensurePage(pages, pageValue);
    if (pageHostValue) page.pageHosts.add(pageHostValue);
    if (visitorId != null) page.uniqueVisitors.add(String(visitorId));
    const eventAt = timestampFor(record, commonLog);
    const hour = bucketIndex(
      timeField === "clientAt" ? clientAt : record.receivedAt,
    );
    const trend = hour == null ? null : result.trend[hour];
    const hourly = hour == null ? null : hourlyMetrics[hour];

    if (type === "pv") {
      result.overview.pageViews += 1;
      page.pageViews += 1;
      const linkedPvContext =
        visitorId == null
          ? null
          : resolveContext(String(visitorId), record.receivedAt);
      if (linkedPvContext) {
        result.native.matchedPageViews += 1;
        pvContextVisitors.add(String(visitorId));
        pvLinkedContexts.set(String(visitorId), linkedPvContext);
      }
      if (trend) trend.pageViews += 1;
    } else if (type === "api") {
      const numericRc = numberOrNull(typeLog.rc);
      const success = numericRc != null && numericRc >= 200 && numericRc < 300;
      const rt = numberOrNull(typeLog.rt);
      const api = ensureApi(apis, apiKey(typeLog.url));
      api.requests += 1;
      if (success) api.success += 1;
      else api.errors += 1;
      if (rt != null) api.rtValues.push(rt);
      result.overview.apiRequests += 1;
      page.apiRequests += 1;
      if (!success) page.apiErrors += 1;
      if (rt != null) page.apiRtValues.push(rt);
      if (trend) trend.apiRequests += 1;
    } else if (type === "error") {
      result.overview.errors += 1;
      page.errors += 1;
      const clientVersion =
        commonLog.appVersion ?? fallbackContext?.appVersion ?? null;
      const summary = errorSummary(
        typeLog,
        commonLog,
        record,
        visitorId,
        clientVersion,
      );
      if (errors.length < 200) errors.push(summary);
      else if (
        summary.at &&
        (!errors[errors.length - 1].at ||
          summary.at > errors[errors.length - 1].at)
      ) {
        errors[errors.length - 1] = summary;
      }
      errors.sort((a, b) =>
        String(b.at ?? "").localeCompare(String(a.at ?? "")),
      );
      if (visitorId != null) errorVisitors.add(String(visitorId));
      for (const [field, key] of [
        ["types", summary.name],
        ["stages", summary.stage],
        ["reasons", summary.reasonCode],
        ["resources", summary.resourceType],
        ["pages", summary.page],
      ]) {
        addErrorGroup(errorGroups[field], key || "未上报", summary.at);
      }
      if (!summary.reasonCode) result.errorAnalysis.missingReasons += 1;
      addErrorGroup(
        errorGroups.statuses,
        summary.httpStatus == null ? "未上报" : String(summary.httpStatus),
        summary.at,
      );
      addErrorGroup(
        errorGroups.versions,
        summary.version || "未上报",
        summary.at,
      );
      const issueKey = JSON.stringify([
        String(summary.name || "未上报").slice(0, 128),
        summary.reasonCode || "未上报",
        summary.page,
        String(summary.message || "").slice(0, 512),
      ]);
      addErrorGroup(errorGroups.issues, issueKey, summary.at);
      updateIssueDetails(issueDetails, issueKey, summary);
      if (visitorId != null) {
        if (!issueVisitors.has(issueKey))
          issueVisitors.set(issueKey, new Set());
        issueVisitors.get(issueKey).add(String(visitorId));
      }
      if (
        summary.at &&
        (!result.errorAnalysis.latestAt ||
          summary.at > result.errorAnalysis.latestAt)
      )
        result.errorAnalysis.latestAt = summary.at;
      if (trend) {
        trend.errors += 1;
        if (visitorId != null) errorTrendVisitors[hour].add(String(visitorId));
        errorTrendIssues[hour].add(issueKey);
        errorTrendPages[hour].add(summary.page || "未上报");
      }
    } else if (type === "perf_fcp") {
      const value = numberOrNull(typeLog.fcp);
      collectMetric(globalMetrics, "fcp", value);
      collectMetric(page, "fcp", value);
      if (hourly) collectMetric(hourly, "fcp", value);
      page.lastPerfAt = latestTime(page.lastPerfAt, eventAt);
    } else if (type === "perf_fid") {
      const value = numberOrNull(typeLog.fid);
      collectMetric(globalMetrics, "fid", value);
      collectMetric(page, "fid", value);
      if (hourly) collectMetric(hourly, "fid", value);
      page.lastPerfAt = latestTime(page.lastPerfAt, eventAt);
    } else if (type === "perf") {
      const navigationFallback = record.channel === "h5-navigation";
      if (navigationFallback)
        result.userPerception.navigationFallbackSamples += 1;
      if (
        ["fpt", "fcp", "tti"].every((field) => {
          const value = numberOrNull(typeLog[field]);
          return value == null || value < 0;
        })
      ) {
        result.userPerception.missingMilestoneSamples += 1;
        if (navigationFallback)
          result.userPerception.navigationMissingMilestoneSamples += 1;
      }
      for (const stage of PERF_STAGE_IDS) {
        const value = numberOrNull(typeLog[stage]);
        collectMetric(globalMetrics, stage, value);
        collectMetric(page, stage, value);
        if (hourly) collectMetric(hourly, stage, value);
      }
      for (const [source, target] of [
        ["fpt", "fp"],
        ["fcp", "fcp"],
        ["tti", "tti"],
      ]) {
        const value = numberOrNull(typeLog[source]);
        collectMetric(globalMetrics, target, value);
        collectMetric(page, target, value);
        if (hourly) collectMetric(hourly, target, value);
      }
      const open = numberOrNull(typeLog.total ?? typeLog.load);
      if (open != null && open >= 0) {
        globalMetrics.metrics.pageLoad.push(open);
        collectMetric(page, "pageLoad", open);
        if (hourly) collectMetric(hourly, "pageLoad", open);
        page.openSamples.push({
          duration: open,
          visitorId: visitorId == null ? null : String(visitorId),
          firstbyte: numberOrNull(typeLog.firstbyte),
          ready: numberOrNull(typeLog.ready),
          total: numberOrNull(typeLog.total),
        });
        page.durationValues.push(open);
      }
      for (const [field, source] of Object.entries(DIMENSION_FIELDS)) {
        collectDimension(dimensions, field, commonLog[source]);
      }
      const linkedContext =
        visitorId == null
          ? null
          : resolveContext(String(visitorId), record.receivedAt);
      const dimensionContext =
        linkedContext ??
        (hasSingleContext && singleContext.receivedAt == null
          ? singleContext
          : null);
      for (const [field, value] of Object.entries(
        contextDimensionValues(dimensionContext, commonLog),
      )) {
        collectDimension(dimensions, field, value);
        collectDimensionMetrics(dimensionMetrics, field, value, typeLog);
      }
      const coverage = result.userPerception.contextCoverage;
      coverage.total += 1;
      if (linkedContext) coverage.exact += 1;
      else if (hasSingleContext) coverage.singleContextFallback += 1;
      else if (commonLog.ct) coverage.h5NetworkOnly += 1;
      else coverage.none += 1;
      page.lastPerfAt = latestTime(page.lastPerfAt, eventAt);
    } else if (type === "end") {
      const duration = numberOrNull(typeLog.page_duration);
      if (duration != null && duration >= 0) page.durationValues.push(duration);
    }
  }
}

function slowLoadingPage(page, thresholdMs) {
  const values = page.openSamples.map((sample) => sample.duration);
  const slowSamples = page.openSamples.filter(
    (sample) => sample.duration > thresholdMs,
  );
  const count = slowSamples.length;
  return {
    page: page.page,
    pageViews: page.pageViews,
    sampleCount: values.length,
    slowLoadingCount: count,
    slowLoadingRate:
      values.length === 0 ? null : round((count / values.length) * 100),
    averageTotalMs: round(average(values)),
    p50TotalMs: round(percentile(values, 50)),
    p90TotalMs: round(percentile(values, 90)),
    slowFirstbyteMs: round(
      average(
        slowSamples
          .map((sample) => sample.firstbyte)
          .filter((value) => value != null),
      ),
    ),
    slowReadyMs: round(
      average(
        slowSamples
          .map((sample) => sample.ready)
          .filter((value) => value != null),
      ),
    ),
    slowTotalMs: round(
      average(
        slowSamples
          .map((sample) => sample.total)
          .filter((value) => value != null),
      ),
    ),
    lastPerfAt: page.performance.lastPerfAt,
    slowVisitorIds: new Set(
      slowSamples.map((sample) => sample.visitorId).filter((id) => id != null),
    ),
  };
}

/**
 * Aggregate one UTC archive day. When `date` is omitted, the latest available
 * H5 archive day is selected so a user opening the dashboard after midnight
 * still sees the most recent complete data set.
 */
export async function aggregateDashboard({
  dataDir,
  date = null,
  from = null,
  to = null,
  timeField = "receivedAt",
  includePrevious = true,
  slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
  performanceFilters = {},
  pageFilter = "",
  pageHost = "",
  archive = null,
} = {}) {
  if (dataDir == null) throw new TypeError("dataDir is required");
  if (!["receivedAt", "clientAt"].includes(timeField)) {
    const error = new Error("timeField must be receivedAt or clientAt");
    error.code = "INVALID_TIME_FIELD";
    throw error;
  }
  if (date != null && !isValidDate(date)) {
    const error = new Error("date must be YYYY-MM-DD");
    error.code = "INVALID_DATE";
    throw error;
  }
  if ((from == null) !== (to == null) || (from != null && date != null)) {
    const error = new Error("provide either date or both from and to");
    error.code = "INVALID_RANGE";
    throw error;
  }
  const start = from == null ? null : Date.parse(from);
  const end = to == null ? null : Date.parse(to);
  if (
    from != null &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(to) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      new Date(start).toISOString() !== from ||
      new Date(end).toISOString() !== to ||
      end <= start ||
      end - start > 91 * 86400000)
  ) {
    const error = new Error(
      "from/to must be UTC ISO timestamps with a positive interval of at most 91 elapsed days (90 local calendar days with DST allowance)",
    );
    error.code = "INVALID_RANGE";
    throw error;
  }
  const threshold = Number(slowThresholdMs);
  if (
    !Number.isInteger(threshold) ||
    threshold < MIN_SLOW_THRESHOLD_MS ||
    threshold > MAX_SLOW_THRESHOLD_MS
  ) {
    const error = new Error(
      `slowThresholdMs must be an integer between ${MIN_SLOW_THRESHOLD_MS} and ${MAX_SLOW_THRESHOLD_MS}`,
    );
    error.code = "INVALID_SLOW_THRESHOLD";
    throw error;
  }

  if (
    performanceFilters == null ||
    typeof performanceFilters !== "object" ||
    Array.isArray(performanceFilters) ||
    Object.entries(performanceFilters).some(
      ([field, value]) =>
        !PERF_FILTER_FIELDS.includes(field) ||
        typeof value !== "string" ||
        !value ||
        value.length > 128,
    )
  ) {
    const error = new Error("invalid performance dimension filter");
    error.code = "INVALID_PERFORMANCE_FILTER";
    throw error;
  }
  if (
    typeof pageFilter !== "string" ||
    pageFilter.length > 128 ||
    typeof pageHost !== "string" ||
    pageHost.length > 253
  ) {
    const error = new Error("invalid page filter");
    error.code = "INVALID_PAGE_FILTER";
    throw error;
  }

  const source = archive ?? localArchive(dataDir);
  const dates = await source.availableDates();
  const selectedDate =
    date ?? dates.at(-1) ?? new Date().toISOString().slice(0, 10);
  const result = emptyResult(selectedDate);
  result.availableDates = dates;
  result.slowLoading.thresholdMs = threshold;
  result.userPerception.activePageFilter = { pageFilter, pageHost };
  const windowStart = start ?? Date.parse(`${selectedDate}T00:00:00.000Z`);
  const windowEnd = end ?? windowStart + 86400000;
  const rangeDates = dates.filter((day) => {
    const dayStart = Date.parse(`${day}T00:00:00.000Z`);
    const skew = timeField === "clientAt" ? CLIENT_CLOCK_TOLERANCE_MS : 0;
    return (
      dayStart < windowEnd + skew && dayStart + 86400000 > windowStart - skew
    );
  });
  // Buckets use UTC boundaries; windows remain exact half-open receive-time intervals.
  const bucketMs =
    start == null
      ? 3600000
      : end - start <= 3600000
        ? 300000
        : end - start <= 2 * 86400000
          ? 3600000
          : 86400000;
  const bucketStart =
    start == null
      ? Date.parse(`${selectedDate}T00:00:00.000Z`)
      : Math.floor(start / bucketMs) * bucketMs;
  const bucketEnd =
    start == null
      ? bucketStart + 86400000
      : Math.ceil(end / bucketMs) * bucketMs;
  const bucketCount = (bucketEnd - bucketStart) / bucketMs;
  const bucketLabel = (at) =>
    bucketMs === 86400000
      ? new Date(at).toISOString().slice(0, 10)
      : bucketMs === 300000
        ? new Date(at).toISOString().slice(11, 16)
        : new Date(at).toISOString().slice(0, 13).replace("T", " ");
  result.trend = Array.from({ length: bucketCount }, (_, index) => ({
    hour:
      start == null
        ? String(index).padStart(2, "0")
        : bucketLabel(bucketStart + index * bucketMs),
    pageViews: 0,
    apiRequests: 0,
    errors: 0,
    affectedVisitors: 0,
    issues: 0,
    pageCount: 0,
    metrics: {},
  }));
  if (start != null)
    result.range = {
      from,
      to,
      timeField,
      bucket:
        bucketMs === 86400000
          ? "utc-day"
          : bucketMs === 300000
            ? "utc-5-minute"
            : "utc-hour",
    };
  const inWindow = (record) => {
    const time =
      typeof record?.receivedAt === "string"
        ? Date.parse(record.receivedAt)
        : NaN;
    return (
      (start == null && !Number.isFinite(time)) ||
      (Number.isFinite(time) && time >= windowStart && time < windowEnd)
    );
  };
  const clientTimeCoverage = { valid: 0, missingOrSkewed: 0, outsideWindow: 0 };
  result.clientTimeCoverage = clientTimeCoverage;
  const bucketIndex = (value) => {
    if (start == null) return hourIndex(value);
    const time = Date.parse(value);
    const index = Math.floor((time - bucketStart) / bucketMs);
    return Number.isFinite(index) && index >= 0 && index < bucketCount
      ? index
      : null;
  };

  const pages = new Map();
  const pageOptions = new Set();
  const apis = new Map();
  const visitors = new Set();
  const sessions = new Set();
  const projectIds = new Set();
  const globalMetrics = { metrics: metricStore() };
  const hourlyMetrics = Array.from({ length: bucketCount }, () => ({
    metrics: metricStore(),
  }));
  const errorTrendVisitors = Array.from(
    { length: bucketCount },
    () => new Set(),
  );
  const errorTrendIssues = Array.from({ length: bucketCount }, () => new Set());
  const errorTrendPages = Array.from({ length: bucketCount }, () => new Set());
  const filterOptions = Object.fromEntries(
    PERF_FILTER_FIELDS.map((key) => [key, new Set()]),
  );
  result.userPerception.activeFilters = { ...performanceFilters };
  const dimensions = dimensionStore();
  const dimensionMetrics = dimensionMetricStore();
  const errors = result.errors;
  const errorVisitors = new Set();
  const errorGroups = Object.fromEntries(
    [
      "types",
      "stages",
      "reasons",
      "resources",
      "statuses",
      "pages",
      "versions",
      "issues",
    ].map((field) => [field, new Map()]),
  );
  const issueVisitors = new Map();
  const issueDetails = new Map();
  const pvContextVisitors = new Set();
  const pvLinkedContexts = new Map();
  let contextCount = 0;
  const projectedContexts = new Map();
  const contextHistory = new Map();
  const nativeSnapshots = new Map();
  let latestNative = null;
  let latestDiagnostics = null;

  {
    const contextDates = dates.filter((day) => {
      const dayStart = Date.parse(`${day}T00:00:00.000Z`);
      return (
        dayStart < windowEnd &&
        dayStart + 86400000 > windowStart - CONTEXT_LOOKBACK_MS
      );
    });
    for (const day of contextDates) {
      const { text } = await source.readChannelFile(IOS_CONTEXT_CHANNEL, day);
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        try {
          const record = JSON.parse(line);
          const received = Date.parse(record.receivedAt);
          if (
            !Number.isFinite(received) &&
            (start != null || day !== selectedDate)
          )
            continue;
          if (
            Number.isFinite(received) &&
            (received < windowStart - CONTEXT_LOOKBACK_MS ||
              received >= windowEnd)
          )
            continue;
          const insideWindow = !Number.isFinite(received)
            ? true
            : inWindow(record);
          if (insideWindow) {
            result.archive.records += 1;
            inc(result.archive.channels, record.channel ?? IOS_CONTEXT_CHANNEL);
          }
          const projected = contextProjection(record);
          if (projected) {
            // Lookback is only an identity join, never an in-window native sample.
            projectedContexts.set(projected.contextId, projected);
            if (!contextHistory.has(projected.contextId))
              contextHistory.set(projected.contextId, []);
            contextHistory.get(projected.contextId).push(projected);
            if (!insideWindow) continue;
            const contextMatches = matchesPerformanceFilters(
              performanceFilterValues(projected, {}, {}),
              performanceFilters,
            );
            const native = record.context?.native;
            if (
              contextMatches &&
              native &&
              typeof native === "object" &&
              !Array.isArray(native)
            ) {
              result.native.snapshots += 1;
              if (native.trigger === "reporter_start")
                result.native.starts += 1;
              if (native.trigger === "foreground")
                result.native.foregrounds += 1;
              if (native.trigger === "background")
                result.native.backgrounds += 1;
              if (native.trigger === "network_change")
                result.native.networkChanges += 1;
              const snapshot = {
                warningCount: numberOrNull(native.memoryWarningCount),
                residentMemoryBytes: numberOrNull(native.residentMemoryBytes),
                trigger:
                  typeof native.trigger === "string" ? native.trigger : null,
                at: record.receivedAt ?? record.context.capturedAt ?? null,
              };
              nativeSnapshots.set(projected.contextId, snapshot);
              if (
                !latestNative ||
                (snapshot.at &&
                  (!latestNative.at || snapshot.at >= latestNative.at))
              )
                latestNative = snapshot;
              const diagnostic = native.diagnostics;
              if (
                native.trigger === "metrickit_diagnostics" &&
                diagnostic?.source === "MetricKit" &&
                typeof diagnostic.periodStart === "string" &&
                Number.isFinite(Date.parse(diagnostic.periodStart)) &&
                typeof diagnostic.periodEnd === "string" &&
                Number.isFinite(Date.parse(diagnostic.periodEnd)) &&
                Number.isSafeInteger(diagnostic.crashes) &&
                diagnostic.crashes >= 0 &&
                Number.isSafeInteger(diagnostic.hangs) &&
                diagnostic.hangs >= 0 &&
                (!latestDiagnostics || received >= latestDiagnostics.received)
              ) {
                latestDiagnostics = {
                  received,
                  receivedAt: record.receivedAt,
                  periodStart: diagnostic.periodStart,
                  periodEnd: diagnostic.periodEnd,
                  crashes: diagnostic.crashes,
                  hangs: diagnostic.hangs,
                };
              }
            }
          }
        } catch {
          result.archive.malformedLines += 1;
        }
      }
    }
    contextCount = projectedContexts.size;
    result.native.contexts = projectedContexts.size;
    result.native.lookbackContexts = [...contextHistory.values()].filter(
      (entries) =>
        entries.some(
          (entry) =>
            entry.receivedAt && Date.parse(entry.receivedAt) < windowStart,
        ),
    ).length;
    const nativeDimensions = iosDimensionStore();
    for (const projected of projectedContexts.values()) {
      if (
        matchesPerformanceFilters(
          performanceFilterValues(projected, {}, {}),
          performanceFilters,
        )
      )
        collectIosDimensions(nativeDimensions, projected);
    }
    result.native.dimensions = finalizeDimensions(nativeDimensions);
    result.native.memoryWarnings = [...nativeSnapshots.values()].reduce(
      (count, snapshot) => count + Math.max(0, snapshot.warningCount ?? 0),
      0,
    );
    if (latestDiagnostics) {
      const { received, ...publicSummary } = latestDiagnostics;
      result.native.latestDiagnostics = publicSummary;
    }
    if (latestNative) {
      result.native.latestResidentMemoryBytes =
        latestNative.residentMemoryBytes;
      result.native.latestTrigger = latestNative.trigger;
      result.native.latestAt = latestNative.at;
    }
  }

  const resolveContext = (id, eventAt) => {
    const history = contextHistory.get(id) ?? [];
    const at = Date.parse(eventAt);
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      const received = Date.parse(entry.receivedAt);
      if (entry.receivedAt == null && start == null) return entry;
      if (
        Number.isFinite(received) &&
        Number.isFinite(at) &&
        received <= at &&
        at - received <= CONTEXT_LOOKBACK_MS
      )
        return entry;
    }
    return null;
  };
  const context = {
    result,
    pages,
    pageOptions,
    apis,
    visitors,
    sessions,
    projectIds,
    globalMetrics,
    hourlyMetrics,
    bucketIndex,
    timeField,
    windowStart,
    windowEnd,
    clientTimeCoverage,
    dimensions,
    dimensionMetrics,
    filterOptions,
    performanceFilters,
    pageFilter,
    pageHost,
    errors,
    errorGroups,
    errorVisitors,
    errorTrendVisitors,
    errorTrendIssues,
    errorTrendPages,
    issueVisitors,
    issueDetails,
    resolveContext,
    pvContextVisitors,
    pvLinkedContexts,
    hasSingleContext: contextCount === 1,
    singleContext:
      contextCount === 1 ? projectedContexts.values().next().value : null,
  };
  result.userPerception.contextCoverage.contexts = contextCount;

  for (const channel of H5_CHANNELS) {
    for (const day of rangeDates) {
      const { text, missing } = await source.readChannelFile(channel, day);
      if (missing) {
        result.archive.missingFiles += 1;
        continue;
      }
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        try {
          const record = JSON.parse(line);
          if (timeField === "clientAt") {
            const received = Date.parse(record.receivedAt);
            if (
              !Number.isFinite(received) ||
              received < windowStart - CLIENT_CLOCK_TOLERANCE_MS ||
              received >= windowEnd + CLIENT_CLOCK_TOLERANCE_MS
            )
              continue;
            visitRecord(context, record);
          } else if (inWindow(record)) visitRecord(context, record);
        } catch {
          result.archive.malformedLines += 1;
        }
      }
    }
  }

  result.overview.uniqueVisitors = visitors.size;
  result.errorAnalysis.affectedVisitors = errorVisitors.size;
  result.errorAnalysis.pageCount = errorGroups.pages.size;
  result.errorAnalysis.issueCount = errorGroups.issues.size;
  for (const field of [
    "types",
    "stages",
    "reasons",
    "resources",
    "statuses",
    "pages",
    "versions",
  ]) {
    result.errorAnalysis[field] = topErrorGroups(
      errorGroups[field],
      result.overview.errors,
    );
  }
  result.errorAnalysis.issues = topErrorGroups(
    errorGroups.issues,
    result.overview.errors,
  ).map((row) => {
    const [type, reason, page, message] = JSON.parse(row.value);
    const details = issueDetails.get(row.value);
    return {
      type,
      reason,
      page,
      message,
      count: row.count,
      rate: row.rate,
      visitors: issueVisitors.get(row.value)?.size ?? null,
      lastAt: row.lastAt,
      firstAt: details?.firstAt ?? null,
      versionRange: formatVersionRange(details?.versions ?? []),
      firstVersion: details?.firstVersion || "未上报",
      lastVersion: details?.lastVersion || "未上报",
    };
  });
  result.overview.sessions = sessions.size;
  result.overview.projectIds = [...projectIds].sort();
  result.overview.apiSuccessRate =
    result.overview.apiRequests === 0
      ? null
      : round(
          ((result.overview.apiRequests -
            [...apis.values()].reduce((sum, api) => sum + api.errors, 0)) /
            result.overview.apiRequests) *
            100,
        );
  result.overview.averageApiRtMs = round(
    average([...apis.values()].flatMap((api) => api.rtValues)),
  );

  const finalizedPages = [...pages.values()].map(finalizePage);
  result.pages = finalizedPages
    .map(({ openSamples, ...page }) => page)
    .sort((a, b) => b.pageViews - a.pageViews || a.page.localeCompare(b.page));
  result.apis = [...apis.values()]
    .map(finalizeApi)
    .sort((a, b) => b.requests - a.requests || a.api.localeCompare(b.api));

  result.trend = result.trend.map((item, hour) => ({
    ...item,
    affectedVisitors: errorTrendVisitors[hour].size,
    issues: errorTrendIssues[hour].size,
    pageCount: errorTrendPages[hour].size,
    metrics: {
      ...Object.fromEntries(
        [...PERF_STAGE_IDS, "fp", "fcp", "tti", "fid", "pageLoad"].map((id) => [
          id,
          metricSummary(hourlyMetrics[hour].metrics[id]),
        ]),
      ),
      oneSecondFastRate: ratioSummary(
        hourlyMetrics[hour].metrics.pageLoad,
        (value) => value <= 1000,
      ),
      twoSecondFastRate: ratioSummary(
        hourlyMetrics[hour].metrics.pageLoad,
        (value) => value <= 2000,
      ),
      fiveSecondSlowRate: ratioSummary(
        hourlyMetrics[hour].metrics.pageLoad,
        (value) => value > 5000,
      ),
    },
  }));

  result.performance = {
    fcp: {
      count: globalMetrics.metrics.fcp.length,
      p50: round(percentile(globalMetrics.metrics.fcp, 50)),
      p75: round(percentile(globalMetrics.metrics.fcp, 75)),
      p90: round(percentile(globalMetrics.metrics.fcp, 90)),
    },
    fid: {
      count: globalMetrics.metrics.fid.length,
      p50: round(percentile(globalMetrics.metrics.fid, 50)),
      p90: round(percentile(globalMetrics.metrics.fid, 90)),
    },
    pageLoad: {
      count: globalMetrics.metrics.pageLoad.length,
      p50: round(percentile(globalMetrics.metrics.pageLoad, 50)),
      p90: round(percentile(globalMetrics.metrics.pageLoad, 90)),
    },
  };

  const openValues = finalizedPages.flatMap((page) =>
    page.openSamples.map((sample) => sample.duration),
  );
  result.userPerception.filterOptions = Object.fromEntries(
    PERF_FILTER_FIELDS.map((field) => [
      field,
      [...filterOptions[field]].sort((a, b) => a.localeCompare(b)),
    ]),
  );
  result.userPerception.pageOptions = [...pageOptions].sort((a, b) =>
    a.localeCompare(b),
  );
  result.userPerception.metrics = {
    tcp: metricSummary(globalMetrics.metrics.tcp),
    ttfb: metricSummary(globalMetrics.metrics.ttfb),
    fp: metricSummary(globalMetrics.metrics.fp),
    fcp: metricSummary(globalMetrics.metrics.fcp),
    tti: metricSummary(globalMetrics.metrics.tti),
    pageLoad: metricSummary(globalMetrics.metrics.pageLoad),
    oneSecondFastRate: ratioSummary(openValues, (value) => value <= 1000),
    twoSecondFastRate: ratioSummary(openValues, (value) => value <= 2000),
    fiveSecondSlowRate: ratioSummary(openValues, (value) => value > 5000),
  };
  result.userPerception.sampleDistribution = {
    good: openValues.filter((value) => value <= 2000).length,
    fair: openValues.filter((value) => value > 2000 && value <= 5000).length,
    poor: openValues.filter((value) => value > 5000).length,
  };
  result.native.matchedVisitors = pvContextVisitors.size;
  const linkedDimensions = iosDimensionStore();
  for (const visitorId of pvContextVisitors)
    collectIosDimensions(linkedDimensions, pvLinkedContexts.get(visitorId));
  result.native.linkedPageViewDimensions = finalizeDimensions(linkedDimensions);
  result.userPerception.dimensions = finalizeDimensions(dimensions);
  result.userPerception.metricDimensions = finalizeMetricDimensions(
    dimensionMetrics,
    result.userPerception.dimensions,
  );
  result.userPerception.pages = (
    Object.keys(performanceFilters).length
      ? finalizedPages.filter(
          (page) =>
            page.performance.sampleCount > 0 ||
            page.performance.fp.count > 0 ||
            page.performance.fcp.count > 0 ||
            page.performance.tcp.count > 0 ||
            page.performance.ttfb.count > 0,
        )
      : finalizedPages
  )
    .map((page) => ({
      page: page.page,
      pageHosts: page.pageHosts,
      pageViews: page.pageViews,
      uniqueVisitors: page.uniqueVisitors,
      sampleCount: page.performance.sampleCount,
      fp: page.performance.fp,
      fcp: page.performance.fcp,
      tcp: page.performance.tcp,
      ttfb: page.performance.ttfb,
      tti: page.performance.tti,
      pageLoad: page.performance.pageLoad,
      oneSecondFastRate: page.performance.oneSecondFastRate,
      twoSecondFastRate: page.performance.twoSecondFastRate,
      fiveSecondSlowRate: page.performance.fiveSecondSlowRate,
      lastPerfAt: page.performance.lastPerfAt,
    }))
    .sort(
      (a, b) =>
        b.pageViews - a.pageViews ||
        b.sampleCount - a.sampleCount ||
        a.page.localeCompare(b.page),
    );

  result.loadingPerformance.stages = Object.fromEntries(
    PERF_STAGE_IDS.map((id) => [id, metricSummary(globalMetrics.metrics[id])]),
  );
  result.loadingPerformance.pages = (
    Object.keys(performanceFilters).length
      ? finalizedPages.filter((page) => page.performance.sampleCount > 0)
      : finalizedPages
  )
    .map((page) => ({
      page: page.page,
      pageHosts: page.pageHosts,
      pageViews: page.pageViews,
      sampleCount: page.performance.sampleCount,
      stages: page.performance.stages,
      lastPerfAt: page.performance.lastPerfAt,
    }))
    .sort(
      (a, b) =>
        b.sampleCount - a.sampleCount ||
        b.pageViews - a.pageViews ||
        a.page.localeCompare(b.page),
    );

  const slowPages = (
    Object.keys(performanceFilters).length
      ? finalizedPages.filter((page) => page.performance.sampleCount > 0)
      : finalizedPages
  ).map((page) => slowLoadingPage(page, threshold));
  const affected = slowPages.filter((page) => page.slowLoadingCount > 0);
  const affectedVisitors = new Set(
    affected.flatMap((page) => [...page.slowVisitorIds]),
  );
  result.slowLoading.overview = {
    samples: openValues.length,
    slowLoadingCount: openValues.filter((value) => value > threshold).length,
    slowLoadingRate:
      openValues.length === 0
        ? null
        : round(
            (openValues.filter((value) => value > threshold).length /
              openValues.length) *
              100,
          ),
    affectedPages: affected.length,
    affectedVisitors: affectedVisitors.size,
  };
  result.slowLoading.pages = slowPages
    .map(({ slowVisitorIds, ...page }) => page)
    .sort(
      (a, b) =>
        b.slowLoadingCount - a.slowLoadingCount ||
        b.slowLoadingRate - a.slowLoadingRate ||
        b.sampleCount - a.sampleCount ||
        a.page.localeCompare(b.page),
    );
  if (includePrevious && start != null) {
    const duration = end - start;
    const previous = await aggregateDashboard({
      dataDir,
      archive: source,
      from: new Date(start - duration).toISOString(),
      to: from,
      timeField,
      includePrevious: false,
      slowThresholdMs: threshold,
      performanceFilters,
      pageFilter,
      pageHost,
    });
    result.userPerception.previous = {
      from: previous.range.from,
      to: previous.range.to,
      metrics: previous.userPerception.metrics,
    };
  }
  return result;
}

export { isValidDate, PERF_STAGE_IDS, PERF_STAGE_LABELS };
