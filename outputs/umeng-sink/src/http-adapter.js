/**
 * Transport glue between `node:http` and the socket-free handler in
 * `src/handler.js`.
 *
 * This is the only layer that owns framing concerns: buffering the request body,
 * enforcing the size limit before allocation, and writing status/headers/body
 * back. It is written against the small `IncomingMessage`/`ServerResponse`
 * surface (`on('data')`, `on('end')`, `writeHead`, `end`) so it can be driven
 * with plain streams in tests instead of a listening socket.
 */

export class PayloadTooLargeError extends Error {
  constructor(limit) {
    super(`request body exceeds ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
    this.statusCode = 413;
    this.limit = limit;
  }
}

/**
 * Buffers a readable request body, refusing to exceed `maxBodyBytes`.
 * The limit is applied to accumulated bytes, so a large body is rejected while
 * it streams rather than after it has been fully materialised.
 */
export function readRequestBody(readable, { maxBodyBytes }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    readable.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        fail(new PayloadTooLargeError(maxBodyBytes));
        if (typeof readable.destroy === 'function') readable.destroy();
        return;
      }
      chunks.push(chunk);
    });
    readable.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    readable.on('error', fail);
  });
}

function writeResponse(response, { status, headers, body }) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '', 'utf8');
  response.writeHead(status, { ...headers, 'Content-Length': buffer.length });
  response.end(buffer);
}

/**
 * Wraps a socket-free handler into a `http.createServer` request listener.
 * Malformed or oversized requests are answered here; handler faults become 500s
 * so a single bad report can never take the receiver down.
 */
export function createRequestListener(handler, { maxBodyBytes, onError = null } = {}) {
  return async function requestListener(request, response) {
    let result;
    try {
      let body = Buffer.alloc(0);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await readRequestBody(request, { maxBodyBytes });
      }
      result = await handler({
        method: request.method,
        url: request.url,
        headers: request.headers,
        remoteAddress: request.socket?.remoteAddress,
        body,
      });
    } catch (error) {
      if (error?.statusCode === 413) {
        result = { status: 413, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from('payload too large') };
      } else {
        if (onError) onError(error);
        result = { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: Buffer.from('internal error') };
      }
    }
    try {
      writeResponse(response, result);
    } catch (error) {
      if (onError) onError(error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      response.end();
    }
  };
}
