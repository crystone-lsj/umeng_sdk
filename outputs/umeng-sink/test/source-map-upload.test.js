import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SourceMapStore,
  recoverUploadedH5VueSource,
} from "../src/source-map-upload.js";
import { createRequestHandler } from "../src/handler.js";

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const local = Buffer.alloc(30 + nameBytes.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    bytes.copy(local, 30 + nameBytes.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function sourceMapZip() {
  const map = JSON.stringify({
    version: 3,
    file: "app.js",
    sources: ["src/views/Page.vue"],
    sourcesContent: [
      '<template>\n  <div>hello</div>\n</template>\n<script>\nthrow new Error("bad");\n</script>',
    ],
    names: [],
    mappings: "AAAA",
  });
  return zipStore({
    "build/assets/app.js.map": map,
    "build/assets/app.js": 'throw new Error("bad");\n',
  });
}

test("uploaded source maps restore Vue context and survive a store reload", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-map-upload-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SourceMapStore({ dataDir: root });
  const uploaded = await store.upload(sourceMapZip(), "prod.zip");
  assert.deepEqual(
    {
      uploaded: uploaded.uploaded,
      maps: uploaded.maps,
      mappedFiles: uploaded.mappedFiles,
    },
    { uploaded: true, maps: 1, mappedFiles: 1 },
  );
  const input = {
    sourceFile:
      "https://q-fe.aixuexi.com/operation-system/bx-app-h5/assets/app.js",
    line: 1,
    column: 1,
    errorType: "js_exception",
  };
  const restored = await store.recover(input);
  assert.equal(restored.status, "restored");
  assert.equal(restored.file, "src/views/Page.vue");
  assert.equal(restored.line, 1);
  assert.match(restored.lines.join("\n"), /<template>/);
  const reloaded = new SourceMapStore({ dataDir: root });
  assert.equal((await reloaded.recover(input)).status, "restored");
  assert.equal((await reloaded.status()).fileName, "current.zip");
  assert.deepEqual(recoverUploadedH5VueSource(input, null), {
    status: "unavailable",
    reason: "source_map_not_uploaded",
  });
});

test("source map upload endpoint replaces the active index and reports status", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-map-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { handle, store } = createRequestHandler({
    dataDir: root,
    quiet: true,
  });
  t.after(() => store.close());
  const zip = sourceMapZip();
  const response = await handle({
    method: "POST",
    url: "/__sink/api/source-maps",
    headers: {
      "content-type": "application/zip",
      "x-source-map-file-name": "bundle.zip",
    },
    body: zip,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    uploaded: true,
    bytes: zip.length,
    fileName: "bundle.zip",
    maps: 1,
    mappedFiles: 1,
    uploadedAt: JSON.parse(response.body).uploadedAt,
  });
  const status = await handle({
    method: "GET",
    url: "/__sink/api/source-maps",
  });
  assert.equal(JSON.parse(status.body).fileName, "bundle.zip");
  assert.equal(
    (
      await handle({
        method: "POST",
        url: "/__sink/api/source-maps",
        headers: { "content-type": "application/json" },
        body: zip,
      })
    ).status,
    415,
  );
});

test("invalid short ZIP uploads return a client error instead of a server error", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-map-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { handle, store } = createRequestHandler({
    dataDir: root,
    quiet: true,
  });
  t.after(() => store.close());
  const response = await handle({
    method: "POST",
    url: "/__sink/api/source-maps",
    headers: { "content-type": "application/zip" },
    body: Buffer.from("bad"),
  });
  assert.equal(response.status, 400);
});

test("uploaded source maps are applied to ELK dashboard errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "source-map-dashboard-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const zip = sourceMapZip();
  const elkClient = {
    indexPattern: "log-fe-*-gsl_test",
    async scanWindow() {
      return [
        {
          MOD: "h5PageAnalysis",
          EV: "xsm.H5PageError",
          eventType: "page_error",
          timestamp: String(Date.parse("2026-10-20T07:38:43.559Z")),
          route: "/bx-app-h5/learningIndex",
          DTL: JSON.stringify({
            route: "/bx-app-h5/learningIndex",
            errorType: "js_exception",
            sourceFile:
              "https://q-fe.aixuexi.com/operation-system/bx-app-h5/assets/app.js",
            line: 1,
            column: 1,
            message: "bad",
            contextId: "A".repeat(32),
          }),
        },
      ];
    },
    async listApps() {
      return ["学什么"];
    },
    logError() {},
  };
  const { handle, store } = createRequestHandler({
    dataDir: root,
    elkClient,
    dashboardSource: "elk",
    quiet: true,
  });
  t.after(() => store.close());

  const upload = await handle({
    method: "POST",
    url: "/__sink/api/source-maps",
    headers: {
      "content-type": "application/zip",
      "x-source-map-file-name": "prod.zip",
    },
    body: zip,
  });
  assert.equal(upload.status, 200);
  const response = await handle({
    method: "GET",
    url: "/__sink/api/dashboard?date=2026-10-20",
  });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.errors[0].devSource.status, "restored");
  assert.equal(data.errors[0].devSource.file, "src/views/Page.vue");
  assert.match(data.errors[0].devSource.lines.join("\n"), /<template>/);
});
