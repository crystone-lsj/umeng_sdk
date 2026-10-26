import assert from 'node:assert/strict';
import test from 'node:test';
import { createAXXUmengSampledAdapter } from '../src/index.js';

function makeSdk() {
  const calls = {
    init: [],
    exceptions: [],
    apiLogs: []
  };
  return {
    calls,
    init(config) {
      calls.init.push(config);
      return { configured: true };
    },
    captureException(error) {
      calls.exceptions.push(error);
    },
    sendAPILog(args) {
      calls.apiLogs.push(args);
    }
  };
}

test('opens every official sampler gate and keeps adapter rates authoritative', () => {
  const sdk = makeSdk();
  const adapter = createAXXUmengSampledAdapter({ sdk });
  const result = adapter.init({ pid: 'p1', enableRemoteConfig: true });

  assert.equal(adapter.initialized, true);
  assert.equal(result.client.configured, true);
  const config = sdk.calls.init[0];
  assert.equal(config.pid, 'p1');
  assert.equal('sample' in config, false);
  assert.deepEqual(config.sampleConfig, {
    enable: true,
    sampleRate: 100,
    rules: {
      api: { enable: true, sampleRate: 100 },
      error: { enable: true, sampleRate: 100 },
      perf: { enable: true, sampleRate: 100 }
    }
  });
  assert.equal(config.enableRemoteConfig, false);
  assert.equal(config.enableCatchJSError, true);
});

test('removes the native UAPM bridge before initializing the official SDK', () => {
  globalThis.window = {
    UAPM_JSB_CONFIG: { sample: '100', sampleResult: 'N' },
    UAPM_JSBridge: { getLaunchOptionsSync() { return '{}'; } }
  };
  try {
    const sdk = makeSdk();
    const adapter = createAXXUmengSampledAdapter({ sdk });
    const result = adapter.init({
      pid: 'p1',
      sample: 1,
      disableNativeBridge: true
    });

    assert.equal(result.nativeBridgeDisabled, true);
    assert.equal('UAPM_JSB_CONFIG' in globalThis.window, false);
    assert.equal('UAPM_JSBridge' in globalThis.window, false);
    assert.equal('sample' in sdk.calls.init[0], false);
    assert.equal('disableNativeBridge' in sdk.calls.init[0], false);
  } finally {
    delete globalThis.window;
  }
});

test('can retain the native UAPM bridge when explicitly requested', () => {
  globalThis.window = { UAPM_JSB_CONFIG: { sampleResult: 'Y' } };
  try {
    const sdk = makeSdk();
    const adapter = createAXXUmengSampledAdapter({ sdk });
    const result = adapter.init({ pid: 'p1', disableNativeBridge: false });

    assert.equal(result.nativeBridgeDisabled, false);
    assert.equal(globalThis.window.UAPM_JSB_CONFIG.sampleResult, 'Y');
  } finally {
    delete globalThis.window;
  }
});

test('startup switches derive from independent feature rates', () => {
  const sdk = makeSdk();
  const adapter = createAXXUmengSampledAdapter({
    sdk,
    rates: { api: 0, error: 0, perf: 1, perf_fid: 0, blank: 1 }
  });
  adapter.init({
    pid: 'p1',
    hookFetch: true,
    hookXHR: true,
    enableCatchJSError: true,
    enablePerformance: true,
    enableFID: true,
    enableBlankScreen: true
  });
  const config = sdk.calls.init[0];
  assert.equal(config.hookFetch, false);
  assert.equal(config.hookXHR, false);
  assert.equal(config.enableCatchJSError, false);
  assert.equal(config.enablePerformance, true);
  assert.equal(config.enableFID, false);
  assert.equal(config.enableBlankScreen, true);
});

test('event-level wrappers respect runtime rates and force', () => {
  const sdk = makeSdk();
  const adapter = createAXXUmengSampledAdapter({ sdk, rates: { error: 0, api: 0 } });
  adapter.init({ pid: 'p1' });
  const error = new Error('must report');
  const api = { url: '/api/orders', method: 'GET', rt: 10, rc: 200 };

  assert.equal(adapter.captureException(error), false);
  assert.equal(adapter.sendApiLog(api), false);
  assert.deepEqual(sdk.calls.exceptions, []);
  assert.deepEqual(sdk.calls.apiLogs, []);

  adapter.setSamplingRates({ error: 1, api: 1 });
  assert.equal(adapter.captureException(error), true);
  assert.equal(adapter.sendApiLog(api), true);
  assert.deepEqual(sdk.calls.exceptions, [error]);
  assert.deepEqual(sdk.calls.apiLogs, [api]);

  adapter.setSamplingRates({ error: 0, api: 0 });
  assert.equal(adapter.captureException(error, { force: true }), true);
  assert.equal(adapter.sendApiLog(api, { force: true }), true);
  assert.equal(sdk.calls.exceptions.length, 2);
  assert.equal(sdk.calls.apiLogs.length, 2);
});

test('automatic API filter gates by the current api rate', () => {
  const sdk = makeSdk();
  const adapter = createAXXUmengSampledAdapter({ sdk, rates: { api: 1 } });
  adapter.init({ pid: 'p1' });
  const filter = sdk.calls.init[0].apiFilter;
  assert.equal(typeof filter.rules[0], 'function');
  assert.equal(filter.rules[0]('/api', { method: 'GET', rc: 200 }), true);

  adapter.setSamplingRates({ api: 0 });
  assert.equal(filter.rules[0]('/api', { method: 'GET', rc: 200 }), false);
});
