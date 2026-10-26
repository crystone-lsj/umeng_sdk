import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RATES,
  normalizeRates,
  stableRate
} from '../src/sampling.js';

test('normalizes booleans and out-of-range rates', () => {
  const rates = normalizeRates({
    api: true,
    pv: false,
    error: -1,
    perf: 1.5,
    perf_fid: Number.NaN,
    blank: 0.25
  });

  assert.equal(rates.api, 1);
  assert.equal(rates.pv, 0);
  assert.equal(rates.error, 0);
  assert.equal(rates.perf, 1);
  assert.equal(rates.perf_fid, 0);
  assert.equal(rates.blank, 0.25);
  assert.equal(rates.perf_fcp, DEFAULT_RATES.perf_fcp);
});

test('bucketing is deterministic and salt-sensitive', () => {
  assert.equal(stableRate('/home', 'pv', 'salt'), stableRate('/home', 'pv', 'salt'));
  assert.notEqual(stableRate('/home', 'pv', 'salt-a'), stableRate('/home', 'pv', 'salt-b'));
  assert.ok(stableRate('/home', 'pv', 'salt') >= 0);
  assert.ok(stableRate('/home', 'pv', 'salt') < 1);
});
