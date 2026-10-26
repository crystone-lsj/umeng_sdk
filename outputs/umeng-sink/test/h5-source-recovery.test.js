import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequestHandler } from '../src/handler.js';
import { recoverH5VueSource } from '../src/h5-source-recovery.js';

const id = 'abd65d92-a09d-4d99-b9c7-c1cd86f23a63';
const base = 'https://q-fe.aixuexi.com/operation-system/bx-app-h5/';
const script = 'assets/page-legacy-abc.js';
const sourceFile = `${base}${script}`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(root) {
  const dir = path.join(root, id, 'assets');
  await fs.mkdir(dir, { recursive: true });
  const js = Buffer.from('foo();\nthrow new Error("bad");\n');
  const map = Buffer.from(JSON.stringify({ version: 3, file: path.basename(script),
    sources: ['../../../../Users/mac/develop/h5/gs-vue/apps/bx-app-h5/src/views/Page.vue'],
    sourcesContent: ['<template>\n  <div>hello</div>\n</template>\n<script>\nthrow new Error("bad");\n</script>'],
    names: [], mappings: ';AAIA' }));
  await fs.writeFile(path.join(dir, path.basename(script)), js);
  await fs.writeFile(path.join(dir, `${path.basename(script)}.map`), map);
  await fs.writeFile(path.join(root, id, 'manifest.json'), JSON.stringify({
    schema: 'axx-h5-artifacts-v1', artifactId: id, base,
    assets: [{ script, map: `${script}.map`, scriptSha256: sha(js), mapSha256: sha(map) }],
  }));
  return { h5Release: id, sourceFile, line: 2, column: 1, errorType: 'js_exception' };
}

test('maps the exact archived legacy script to bounded original Vue context', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-vue-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = await fixture(root);
  assert.deepEqual(await recoverH5VueSource(input, root), {
    status: 'restored', file: 'src/views/Page.vue', line: 5, column: 1,
    startLine: 2, lines: ['  <div>hello</div>', '</template>', '<script>', 'throw new Error("bad");', '</script>'],
    h5Release: id, sourceFile, generatedLine: 2, generatedColumn: 1, precision: 'source_map_segment',
  });
  assert.deepEqual(await recoverH5VueSource({ ...input, sourceFile: `${base}assets/page-other.js` }, root),
    { status: 'unavailable', reason: 'script_not_in_archive' });
  assert.deepEqual(await recoverH5VueSource({ ...input, h5Release: undefined }, root),
    { status: 'unavailable', reason: 'release_missing' });
  assert.deepEqual(await recoverH5VueSource({ ...input, line: 100 }, root),
    { status: 'unavailable', reason: 'position_out_of_bounds' });
  assert.deepEqual(await recoverH5VueSource({ ...input, errorType: 'resource_error' }, root),
    { status: 'unavailable', reason: 'resource_has_no_code_position' });
  assert.equal((await recoverH5VueSource({ ...input, errorType: 'unhandled_rejection' }, root)).status,
    'restored');
  await fs.appendFile(path.join(root, id, script), 'modified');
  assert.deepEqual(await recoverH5VueSource(input, root),
    { status: 'unavailable', reason: 'archive_digest_mismatch' });
});

test('valid archive with no Vue mapping does not return unrelated source', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-vue-unmapped-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = await fixture(root);
  const mapPath = path.join(root, id, `${script}.map`);
  const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
  map.sources[0] = 'src/views/Page.js';
  const bytes = Buffer.from(JSON.stringify(map));
  await fs.writeFile(mapPath, bytes);
  const manifestPath = path.join(root, id, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.assets[0].mapSha256 = sha(bytes);
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  assert.deepEqual(await recoverH5VueSource(input, root),
    { status: 'unavailable', reason: 'vue_mapping_missing' });
  await fs.unlink(mapPath);
  await fs.symlink(path.join(root, id, script), mapPath);
  assert.deepEqual(await recoverH5VueSource(input, root),
    { status: 'unavailable', reason: 'archive_unavailable' });
});

test('source recovery endpoint is disabled by default and requires a server-side secret', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'h5-vue-api-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = await fixture(root);
  const token = 'source-recovery-private-token-at-least-32';
  const request = (headers = {}, body = input) => ({ method: 'POST', url: '/__sink/api/h5-source',
    headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(body)) });
  const disabled = createRequestHandler({ dataDir: path.join(root, 'data1'), quiet: true });
  t.after(() => disabled.store.close());
  assert.equal((await disabled.handle(request())).status, 503);
  const withoutEndpointToken = createRequestHandler({ dataDir: path.join(root, 'data2'), sourceArchiveDir: root, quiet: true });
  t.after(() => withoutEndpointToken.store.close());
  assert.equal((await withoutEndpointToken.handle(request())).status, 503);
  const enabled = createRequestHandler({ dataDir: path.join(root, 'data3'), sourceArchiveDir: root,
    sourceAuthToken: token, quiet: true });
  t.after(() => enabled.store.close());
  assert.equal((await enabled.handle(request())).status, 403);
  assert.equal((await enabled.handle(request({ authorization: 'Bearer incorrect' }))).status, 403);
  const response = await enabled.handle(request({ authorization: `Bearer ${token}` }));
  assert.equal(response.status, 200);
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(JSON.parse(response.body).file, 'src/views/Page.vue');
  const preflight = await enabled.handle({ method: 'OPTIONS', url: '/__sink/api/h5-source' });
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], undefined);
  const dashboard = await enabled.handle({ method: 'GET', url: '/__sink/api/dashboard?date=2026-10-20' });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.includes(Buffer.from('throw new Error("bad")')), false);
});
