export const FEATURES = Object.freeze([
  'api',
  'pv',
  'error',
  'perf',
  'perf_fcp',
  'perf_fid',
  'blank'
]);

export const DEFAULT_RATES = Object.freeze({
  api: 1,
  pv: 1,
  error: 1,
  perf: 1,
  perf_fcp: 1,
  perf_fid: 1,
  blank: 1
});

/**
 * Normalize booleans and 0..1 numbers. Unknown values fail closed as 0 so an
 * invalid remote/configuration payload cannot accidentally enable collection.
 */
export function normalizeRates(input = {}) {
  const output = { ...DEFAULT_RATES, ...input };
  const normalized = {};
  for (const feature of FEATURES) {
    const value = output[feature];
    normalized[feature] = value === true ? 1 : value === false ? 0 : clampRate(value);
  }
  return Object.freeze(normalized);
}

function clampRate(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

/**
 * FNV-1a is intentionally dependency-free and stable across browsers and
 * reloads. It is a bucketing hash, not a security primitive.
 */
export function stableHash(text, salt = '') {
  const value = `${salt}\0${String(text)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function stableRate(subject, feature, salt = '') {
  return stableHash(`${feature}:${subject}`, salt) / 0x100000000;
}

export function subjectFor(feature, subject) {
  if (subject !== undefined && subject !== null && subject !== '') return String(subject);
  if (feature === 'pv' && typeof location !== 'undefined') {
    return `${location.pathname}${location.search}`;
  }
  return String(subject ?? '');
}
