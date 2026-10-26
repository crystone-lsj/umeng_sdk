/** Optional server-only transport for the official @alicloud/log Node SDK. */
const PAGE_SIZE = 100;
const MAX_FETCHED = 10000;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export async function createAliyunSlsClient({ endpoint, project, logstore, credentialsProvider, Client } = {}) {
  if (!endpoint || !/^(https:\/\/)?[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(endpoint) ||
      !IDENTIFIER.test(project ?? '') || !IDENTIFIER.test(logstore ?? '') ||
      typeof credentialsProvider?.getCredentials !== 'function') {
    throw new TypeError('SLS requires endpoint, project, logstore and server credentialsProvider');
  }
  // No dependency is loaded when SLS is off. No static keys in source or SDKs.
  const SdkClient = Client ?? (await import('@alicloud/log')).default;
  const sdk = new SdkClient({ endpoint: endpoint.startsWith('https://') ? endpoint : `https://${endpoint}`, credentialsProvider });
  return {
    async put(event, { signal } = {}) {
      if (signal?.aborted) throw new Error('SLS write aborted');
      const timestamp = Date.parse(event.receivedAt);
      if (!Number.isFinite(timestamp)) throw new TypeError('invalid receivedAt');
      // Payload contains only the already-redacted projection from SlsMirror.
      await sdk.postLogStoreLogs(project, logstore, { logs: [{ timestamp: Math.floor(timestamp / 1000),
        content: { channel: event.channel, mirrorId: event.mirrorId, payload: JSON.stringify(event) } }] },
      { timeout: 5000, signal });
    },
    async readDay(channel, utcDay, { limit = MAX_FETCHED, signal } = {}) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay) || !IDENTIFIER.test(channel)) throw new TypeError('invalid SLS day/channel');
      const from = new Date(`${utcDay}T00:00:00.000Z`);
      if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== utcDay) throw new TypeError('invalid SLS day');
      const to = new Date(from.getTime() + 86400000);
      const events = [];
      let offset = 0;
      // The SDK returns the JSON log rows but not HTTP x-log-progress headers.
      // Read every page; SlsMirror additionally proves exact local/remote ID and
      // content equality before accepting the result, including index lag.
      while (offset < limit && offset < MAX_FETCHED) {
        if (signal?.aborted) throw new Error('SLS read aborted');
        const pageSize = Math.min(PAGE_SIZE, limit - offset, MAX_FETCHED - offset);
        const response = await sdk.getLogs(project, logstore, from, to,
          { query: '*', offset, line: pageSize }, { timeout: 5000, signal });
        if (!Array.isArray(response) || response.length > pageSize) throw new TypeError('SLS returned an incomplete/unexpected page');
        for (const log of response) {
          if (typeof log?.payload !== 'string') throw new TypeError('SLS log missing payload');
          const event = JSON.parse(log.payload);
          if (event.channel === channel && event.receivedAt?.slice(0, 10) === utcDay) events.push(event);
        }
        if (response.length < pageSize) return { events, complete: true };
        offset += response.length;
      }
      return { events, complete: false };
    },
  };
}
