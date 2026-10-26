import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import { PayloadTooLargeError, createRequestListener, readRequestBody } from '../src/http-adapter.js';

function fakeResponse() {
  const chunks = [];
  return {
    statusCode: null,
    headers: null,
    headersSent: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      if (body) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
    get body() {
      return Buffer.concat(chunks);
    },
  };
}

function fakeRequest({ method = 'POST', url = '/', headers = {}, chunks = [] } = {}) {
  const stream = Readable.from(chunks);
  stream.method = method;
  stream.url = url;
  stream.headers = headers;
  return stream;
}

test('readRequestBody buffers the whole stream', async () => {
  const body = await readRequestBody(Readable.from([Buffer.from('ab'), Buffer.from('cd')]), {
    maxBodyBytes: 1024,
  });
  assert.deepEqual(body, Buffer.from('abcd'));
});

test('readRequestBody refuses a body over the limit instead of buffering it', async () => {
  await assert.rejects(
    readRequestBody(Readable.from([Buffer.alloc(100, 1)]), { maxBodyBytes: 64 }),
    (error) => error instanceof PayloadTooLargeError && error.statusCode === 413
  );
});

test('the listener buffers the body and writes status, headers and body back', async () => {
  const seen = [];
  const listener = createRequestListener(
    async (request) => {
      seen.push(request);
      return { status: 201, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('hello') };
    },
    { maxBodyBytes: 1024 }
  );

  const response = fakeResponse();
  await listener(
    fakeRequest({ url: '/unify_logs', headers: { 'content-type': 'application/thrift' }, chunks: [Buffer.from('payload')] }),
    response
  );

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].body, Buffer.from('payload'));
  assert.equal(seen[0].method, 'POST');
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['Content-Length'], 5);
  assert.deepEqual(response.body, Buffer.from('hello'));
});

test('GET requests are not waited on for a body', async () => {
  const seen = [];
  const listener = createRequestListener(
    async (request) => {
      seen.push(request);
      return { status: 200, headers: {}, body: Buffer.alloc(0) };
    },
    { maxBodyBytes: 1024 }
  );

  await listener(fakeRequest({ method: 'GET', url: '/__sink/health' }), fakeResponse());
  assert.equal(seen[0].body.length, 0);
});

test('an oversized body becomes 413 and never reaches the handler', async () => {
  let called = false;
  const listener = createRequestListener(
    async () => {
      called = true;
      return { status: 200, headers: {}, body: Buffer.alloc(0) };
    },
    { maxBodyBytes: 8 }
  );

  const response = fakeResponse();
  await listener(fakeRequest({ chunks: [Buffer.alloc(64, 1)] }), response);
  assert.equal(called, false);
  assert.equal(response.statusCode, 413);
});

test('a failing handler becomes 500 so one bad report cannot take the receiver down', async () => {
  const errors = [];
  const listener = createRequestListener(
    async () => {
      throw new Error('boom');
    },
    { maxBodyBytes: 1024, onError: (error) => errors.push(error) }
  );

  const response = fakeResponse();
  await listener(fakeRequest(), response);
  assert.equal(response.statusCode, 500);
  assert.equal(errors.length, 1);
});
