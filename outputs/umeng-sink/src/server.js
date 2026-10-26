/**
 * `node:http` binding for the self-hosted Umeng receiver.
 *
 * Routing lives in `src/handler.js` (transport-independent, unit-tested without
 * sockets) and framing lives in `src/http-adapter.js`. This module only owns the
 * listening socket and shutdown.
 */

import { createServer } from 'node:http';

import { DEFAULT_MAX_BODY_BYTES, DEFAULT_OPTIONS, createRequestHandler, normalizePath } from './handler.js';
import { createRequestListener } from './http-adapter.js';

export { DEFAULT_MAX_BODY_BYTES, DEFAULT_OPTIONS, createRequestHandler, normalizePath };

export function createSinkServer(options = {}) {
  const { handle, store, mirror, elkClient, elkClients, config, log } = createRequestHandler(options);
  const listener = createRequestListener(handle, {
    maxBodyBytes: config.maxBodyBytes,
    onError: (error) => log(`[umeng-sink] request failed: ${error.stack ?? error.message}`),
  });

  const server = createServer((request, response) => {
    listener(request, response);
  });

  return {
    server,
    store,
    mirror,
    elkClient,
    elkClients,
    config,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await store.close();
      await mirror?.flush();
    },
  };
}
