import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestHandler } from '../src/handler.js';
import { recoverViteDevError, enrichViteDevErrors } from '../src/vite-dev-recovery.js';

const origin = 'http://10.16.110.107:5173';
const file = `${origin}/src/views/learning/learningIndex/index.vue`;
const at = Date.parse('2026-10-22T10:41:55.695Z');

function vlq(number) {
  let value = number < 0 ? (-number * 2 + 1) : number * 2;
  let result = '';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  do {
    let digit = value & 31;
    value >>>= 5;
    if (value) digit |= 32;
    result += alphabet[digit];
  } while (value);
  return result;
}

function fixture({ map = true, big = false, redirect = false } = {}) {
  const source = Array.from({ length: 105 }, (_, index) => index === 102
    ? 'return pageConfig.title ?? route.meta.title;' : `// line ${index + 1}`).join('\n');
  const generated = Array.from({ length: 45 }, (_, index) => index === 42
    ? '                   return pageConfig.title;' : '').join('\n');
  const data = { version: 3, sources: [file], sourcesContent: [source], names: [],
    mappings: ';'.repeat(42) + [vlq(19), vlq(0), vlq(102), vlq(19)].join('') };
  const script = generated + (map ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(data)).toString('base64')}` : '');
  const urls = [];
  const fetchModule = async (url, options) => {
    urls.push([url, options.redirect]);
    if (redirect) return new Response('', { status: 302, headers: { Location: 'http://evil.invalid/secret' } });
    return new Response(big ? 'x'.repeat(3 * 1024 * 1024 + 1) : script,
      { headers: { 'content-type': 'text/javascript' } });
  };
  return { fetchModule, urls };
}

const error = { name: 'unhandled_rejection', file, line: 43, column: 20 };

test('restores current Vite module without release or a snippet in the log', async () => {
  const { fetchModule, urls } = fixture();
  const recovered = await recoverViteDevError(error, origin, null, { fetchModule });
  assert.equal(recovered.status, 'restored');
  assert.equal(recovered.file, 'src/views/learning/learningIndex/index.vue');
  assert.equal(recovered.line, 103);
  assert.equal(recovered.column, 20);
  assert.equal(recovered.lines[2], 'return pageConfig.title ?? route.meta.title;');
  assert.equal(recovered.mapping, 'current_vite_dev_module');
  assert.deepEqual(urls, [[file, 'error']]);
});

test('only configured origin and Vue modules may trigger reads; missing or unsafe modules are unavailable', async () => {
  const fixtureData = fixture();
  for (const unsafe of [`http://evil.invalid/src/a.vue`, `${origin}/src/a.js`,
    `${origin}/@fs/private.vue`, `${file}?type=script`, `${origin}/src/%2e%2e/private.vue`]) {
    assert.equal((await recoverViteDevError({ ...error, file: unsafe }, origin, null, fixtureData)).status, 'unavailable');
  }
  assert.equal(fixtureData.urls.length, 0);
  assert.equal((await recoverViteDevError({ ...error, name: 'resource_error' }, origin, null, fixtureData)).status, 'unavailable');
  assert.equal((await recoverViteDevError(error, origin, null, fixture({ map: false }))).status, 'unavailable');
  assert.equal((await recoverViteDevError(error, origin, null, fixture({ big: true }))).status, 'unavailable');
  assert.equal((await recoverViteDevError(error, origin, null, fixture({ redirect: true }))).status, 'unavailable');
  const errors = Array.from({ length: 8 }, (_, index) => ({ ...error, file: `${origin}/src/page${index}.vue` }));
  const capped = fixture();
  await enrichViteDevErrors(errors, origin, capped);
  assert.equal(capped.urls.length, 4);
});

test('ELK dashboard never reads a running Vite server for source recovery', async (t) => {
  const elkClient = { indexPattern: 'log-fe-*-gsl_test', async scanWindow() { return [
    { MOD: 'h5PageAnalysis', EV: 'xsm.H5PageError', eventType: 'page_error',
      timestamp: String(at), eventId: 'vite-test', sourceFile: file, line: '43', column: '20',
      errorType: 'unhandled_rejection', message: 'null is not an object', route: '/bx-app-h5/learningIndex',
      h5Release: 'irrelevant-build-id', codeSnippet: 'stale snippet from log' },
  ]; }, async listApps() { return []; } };
  const { fetchModule, urls } = fixture();
  const setup = (extra) => createRequestHandler({ dataDir: '/tmp/umeng-vite-map-test',
    quiet: true, elkClient, dashboardSource: 'elk', fetchDevModule: fetchModule, ...extra });
  const disabled = setup();
  t.after(() => disabled.store.close());
  const path = '/__sink/api/dashboard?date=2026-10-22';
  const plain = JSON.parse((await disabled.handle({ method: 'GET', url: path })).body);
  assert.equal(plain.errors[0].devSource, undefined);
  assert.equal(urls.length, 0);
  const enabled = setup({ host: '0.0.0.0', viteDevOrigin: origin });
  t.after(() => enabled.store.close());
  const response = await enabled.handle({ method: 'GET', url: path });
  const data = JSON.parse(response.body);
  assert.equal(data.errors[0].devSource, undefined);
  assert.equal(data.errors[0].codeSnippet, null);
  assert.equal(urls.length, 0);
  assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
  const page = await enabled.handle({ method: 'GET', url: '/__sink/dashboard' });
  assert.match(page.body.toString(), /Vue 源码位置/);
  assert.equal(page.headers['Access-Control-Allow-Origin'], '*');
});
