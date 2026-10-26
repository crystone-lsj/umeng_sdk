import {
  DEFAULT_RATES,
  FEATURES,
  normalizeRates,
  stableRate,
  subjectFor
} from './sampling.js';

export { DEFAULT_RATES, FEATURES, normalizeRates, stableRate } from './sampling.js';

function identity(value) {
  return value;
}

function composeFilters(userFilter, samplingFilter) {
  if (!userFilter && !samplingFilter) return undefined;
  return {
    mode: 'match',
    rules: [
      (page, data) => {
        if (userFilter && !passesFilter(userFilter, page, data)) return false;
        return samplingFilter ? samplingFilter(page, data) : true;
      }
    ]
  };
}

function passesFilter(filter, page, data) {
  if (!filter) return true;
  const rules = Array.isArray(filter.rules) ? filter.rules : [filter.rules];
  const matched = rules.some((rule) => {
    if (typeof rule === 'function') return Boolean(rule(page, data));
    if (rule instanceof RegExp) return rule.test(page);
    return page.includes(rule);
  });
  return filter.mode === 'match' ? matched : !matched;
}

function shouldEnable(value, enabled) {
  if (!enabled) return false;
  if (typeof value === 'boolean') return value;
  return true;
}

// @umengfe/apm@2.0.11 reads `sampleRate` on a 0-100 scale and applies
// per-feature `rules` on top of the global gate. Opening every official gate
// lets this adapter own sampling; partial objects are unsafe because the SDK
// dereferences `rules.api`, `rules.error` and `rules.perf` unconditionally.
const OPEN_SAMPLE_CONFIG = Object.freeze({
  enable: true,
  sampleRate: 100,
  rules: Object.freeze({
    api: Object.freeze({ enable: true, sampleRate: 100 }),
    error: Object.freeze({ enable: true, sampleRate: 100 }),
    perf: Object.freeze({ enable: true, sampleRate: 100 })
  })
});

/**
 * In the official 2.0.11 bundle, a native UAPM bridge switches reporting into
 * `On()`, which forwards only batches starting with "perf|" to the bridge;
 * api/error/pv batches are logged as successful but never sent. It also lets
 * `window.UAPM_JSB_CONFIG.sampleResult === "N"` drop every batch. Removing the
 * detection globals before `sdk.init()` keeps the SDK on its HTTP `dsn` path,
 * which is the path used by the self-hosted receiver.
 */
function removeNativeUapmBridge() {
  if (typeof window === 'undefined') return false;
  let removed = false;
  if ('UAPM_JSB_CONFIG' in window) {
    delete window.UAPM_JSB_CONFIG;
    removed = true;
  }
  if ('UAPM_JSBridge' in window) {
    delete window.UAPM_JSBridge;
    removed = true;
  }
  return removed;
}

export function createAXXUmengSampledAdapter(options = {}) {
  const sdk = options.sdk;
  const salt = options.salt ?? '';
  let rates = normalizeRates(options.rates ?? options.samplingRates);
  let initialized = false;

  function shouldSample(feature, subject, { force = false } = {}) {
    if (force) return true;
    if (!FEATURES.includes(feature)) return false;
    const rate = rates[feature];
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    return stableRate(subjectFor(feature, subject), feature, salt) < rate;
  }

  function setSamplingRates(input) {
    rates = normalizeRates({ ...rates, ...input });
    return rates;
  }

  function getSamplingRates() {
    return rates;
  }

  function samplingFilterFor(feature, subjectOfContext) {
    return (page, data) => shouldSample(feature, subjectOfContext(page, data));
  }

  function init(config = {}) {
    if (!sdk || typeof sdk.init !== 'function') {
      throw new TypeError('createAXXUmengSampledAdapter requires an sdk with init()');
    }

    const userPageFilter = config.pageFilter;
    const userErrorFilter = config.errorFilter;
    const userApiFilter = config.apiFilter;
    const disableNativeBridge = config.disableNativeBridge !== false;

    if (disableNativeBridge) removeNativeUapmBridge();

    const initConfig = {
      ...config,
      sampleConfig: OPEN_SAMPLE_CONFIG,
      enableRemoteConfig: false,
      pageFilter: composeFilters(
        userPageFilter,
        samplingFilterFor('pv', (page, data) => {
          const type = data?.type ?? data?.logType;
          return type ? `${type}:${page}` : `unidentified:${page}`;
        })
      ),
      errorFilter: composeFilters(
        userErrorFilter,
        samplingFilterFor('error', (page, data) => {
          const type = data?.type ?? data?.logType;
          const name = data?.name ?? data?.error?.name ?? '';
          const message = data?.message ?? data?.error?.message ?? '';
          return `${name}:${message}:${type ?? ''}`;
        })
      ),
      apiFilter: composeFilters(
        userApiFilter,
        samplingFilterFor('api', (page, data) => {
          const method = data?.method ?? data?.requestMethod ?? '';
          const status = data?.rc ?? data?.status ?? '';
          return `${method}:${status}:${page}`;
        })
      )
    };

    // `sample` is inert in the official SDK: bridge rates come only from
    // window.UAPM_JSB_CONFIG / UAPM_JSBridge. Drop it so callers cannot think
    // it is configured. The adapter-only switch is not an official option.
    delete initConfig.sample;
    delete initConfig.disableNativeBridge;

    initConfig.enableCatchJSError = shouldEnable(
      config.enableCatchJSError,
      rates.error > 0
    );
    initConfig.hookFetch = shouldEnable(config.hookFetch, rates.api > 0);
    initConfig.hookXHR = shouldEnable(config.hookXHR, rates.api > 0);
    initConfig.enablePerformance = shouldEnable(
      config.enablePerformance,
      rates.perf > 0
    );
    initConfig.enableFID = shouldEnable(config.enableFID, rates.perf_fid > 0);
    initConfig.enableBlankScreen = shouldEnable(
      config.enableBlankScreen,
      rates.blank > 0
    );

    const client = sdk.init(initConfig);
    initialized = true;
    return {
      client,
      rates: getSamplingRates(),
      appliedConfig: initConfig,
      nativeBridgeDisabled: disableNativeBridge
    };
  }

  function captureException(error, callOptions = {}) {
    if (!shouldSample('error', String(error?.stack || error?.message || error), callOptions)) {
      return false;
    }
    sdk.captureException(error);
    return true;
  }

  function sendApiLog(args, callOptions = {}) {
    if (!shouldSample('api', String(args?.url || ''), callOptions)) return false;
    sdk.sendAPILog(args);
    return true;
  }

  return {
    get initialized() {
      return initialized;
    },
    get policy() {
      return Object.freeze({
        eventLevel: Object.freeze(['api', 'error']),
        startupLevel: Object.freeze(['perf', 'perf_fid', 'blank']),
        bestEffortRuntime: Object.freeze(['pv'])
      });
    },
    init,
    shouldSample,
    setSamplingRates,
    getSamplingRates,
    captureException,
    sendApiLog
  };
}

export async function initAXXUmengSampled(options = {}) {
  const moduleId = options.moduleId ?? '@umengfe/apm';
  const imported = options.sdk ? { sdk: options.sdk } : await import(moduleId);
  const adapter = createAXXUmengSampledAdapter({
    ...options,
    sdk: imported.sdk ?? imported.default ?? imported
  });
  adapter.init(options.config ?? options);
  return adapter;
}
