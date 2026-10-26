/** One source per complete dashboard query (including context lookback and previous window). */
import { aggregateDashboard } from './aggregate.js';
import { localArchive } from './archive-source.js';

export async function queryDashboard(options, mirror = null, log = () => {}) {
  if (!mirror) return { ...await aggregateDashboard(options), storage: { source: 'local', reason: 'SLS not configured' } };
  const local = localArchive(options.dataDir);
  const allDates = await local.availableDates();
  const selected = options.date ?? allDates.at(-1) ?? new Date().toISOString().slice(0, 10);
  const start = options.from ? Date.parse(options.from) : Date.parse(`${selected}T00:00:00.000Z`);
  const end = options.to ? Date.parse(options.to) : start + 86400000;
  // Include client-clock skew, native context lookback, and previous comparison.
  const previous = options.from && options.includePrevious !== false ? end - start : 0;
  const dates = allDates.filter((day) => {
    const beginning = Date.parse(`${day}T00:00:00.000Z`);
    return beginning < end + 86400000 && beginning + 86400000 > start - previous - 86400000;
  });
  if (!dates.length) return { ...await aggregateDashboard(options), storage: { source: 'local', reason: 'no local archive coverage' } };
  try {
    // Never mix sources: any incomplete page, legacy record, or failed read
    // causes the entire aggregation (and its previous period) to use local.
    const source = await mirror.archiveFor(local, dates);
    return { ...await aggregateDashboard({ ...options, archive: source }), storage: { source: 'sls' } };
  } catch (error) {
    // Provider errors may contain endpoint URLs or credential metadata; do not echo them.
    const internalReasons = new Set(['local day exceeds SLS comparison limit', 'historical or unmirrored local events',
      'SLS day incomplete', 'SLS day identity mismatch', 'SLS query did not cover requested day', 'SLS read timeout']);
    const reason = internalReasons.has(error?.message) ? error.message : 'SLS query unavailable';
    log(`[umeng-sink] SLS dashboard fallback: ${reason}`);
    return { ...await aggregateDashboard(options), storage: { source: 'local', reason } };
  }
}
