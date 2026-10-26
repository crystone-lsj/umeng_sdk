/** The archive is the owner of dashboard input; both backends expose this contract. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DASHBOARD_CHANNELS = Object.freeze(['h5-logs', 'h5-beacon', 'h5-navigation', 'ios-context']);
const VALID_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function localArchive(dataDir) {
  return {
    source: 'local',
    async availableDates() {
      let names;
      try { names = await readdir(dataDir); }
      catch (error) {
        if (error?.code === 'ENOENT') return [];
        throw error;
      }
      const days = new Set();
      for (const name of names) {
        const match = /^(h5-logs|h5-beacon|h5-navigation|ios-context)-(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(name);
        if (match && VALID_DAY.test(match[2]) && !Number.isNaN(Date.parse(`${match[2]}T00:00:00Z`)) &&
            new Date(`${match[2]}T00:00:00Z`).toISOString().slice(0, 10) === match[2]) days.add(match[2]);
      }
      return [...days].sort();
    },
    async readChannelFile(channel, date) {
      if (!DASHBOARD_CHANNELS.includes(channel) || !VALID_DAY.test(date)) throw new TypeError('invalid archive channel or date');
      try { return { text: await readFile(join(dataDir, `${channel}-${date}.ndjson`), 'utf8'), missing: false }; }
      catch (error) {
        if (error?.code === 'ENOENT') return { text: '', missing: true };
        throw error;
      }
    },
  };
}
