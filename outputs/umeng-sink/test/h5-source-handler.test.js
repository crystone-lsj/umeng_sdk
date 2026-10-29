import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/handler.js";

test("source status endpoint exposes configuration without an absolute source path", async () => {
  const root = await mkdtemp(join(tmpdir(), "umeng-h5-handler-"));
  await mkdir(join(root, "bx-app-h5", "src"), { recursive: true });
  const { handle, store } = createRequestHandler({
    dataDir: await mkdtemp(join(tmpdir(), "umeng-sink-data-")),
    h5AppsRoot: root,
    h5DefaultApp: "bx-app-h5",
    h5AppMap: { 学什么: "bx-app-h5" },
    quiet: true,
  });
  try {
    const response = await handle({
      method: "GET",
      url: "/__sink/api/h5-source/status",
    });
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(body, {
      configured: true,
      defaultApp: "bx-app-h5",
      apps: ["bx-app-h5", "学什么"],
    });
    assert.equal(JSON.stringify(body).includes(root), false);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
