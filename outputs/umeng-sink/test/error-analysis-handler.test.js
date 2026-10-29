import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRequestHandler } from "../src/handler.js";

const error = {
  eventId: "event-1",
  errorKey: "key-1",
  app: "bx-app-h5",
  name: "js_exception",
  message: "boom",
  file: "http://localhost:5173/src/page.vue",
  line: 3,
  column: 4,
  page: "/home",
};

async function waitForJob(handle, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await handle({
      method: "GET",
      url: `/__sink/api/error-analysis/${jobId}`,
    });
    const body = JSON.parse(response.body.toString("utf8"));
    if (body.status === "completed" || body.status === "failed") return body;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("analysis job did not finish");
}

test("error-analysis HTTP API exposes configuration, queue and result states", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "umeng-sink-ai-handler-"));
  const catalog = {
    configured: true,
    defaultApp: "bx-app-h5",
    resolveFile() {
      return { file: "src/page.vue", absolute: "/tmp/page.vue" };
    },
    async readSnippet(_app, file, line, column) {
      return {
        app: "bx-app-h5",
        file,
        line,
        column,
        startLine: line,
        endLine: line,
        lines: ["const value = 1;"],
      };
    },
    async listFiles() {
      return [];
    },
    async sourceVersion() {
      return "revision-1";
    },
  };
  const { handle, store } = createRequestHandler({
    dataDir,
    quiet: true,
    h5SourceCatalog: catalog,
    aiProvider: {
      configured: true,
      async analyzeError() {
        return {
          status: "selected",
          candidateIndex: 0,
          reason: "selected",
          confidence: "high",
        };
      },
    },
  });
  try {
    const status = await handle({
      method: "GET",
      url: "/__sink/api/error-analysis",
    });
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body.toString("utf8")).configured, true);

    const created = await handle({
      method: "POST",
      url: "/__sink/api/error-analysis",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ error })),
    });
    assert.equal(created.status, 202);
    const job = JSON.parse(created.body.toString("utf8"));
    assert.ok(["queued", "running", "completed"].includes(job.status));
    const result = await waitForJob(handle, job.jobId);
    assert.equal(result.result.file, "src/page.vue");
    assert.equal(result.result.line, 3);

    const missing = await handle({
      method: "GET",
      url: "/__sink/api/error-analysis/missing",
    });
    assert.equal(missing.status, 404);
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("error-analysis HTTP API rejects requests when the server is not configured", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "umeng-sink-ai-disabled-"));
  const { handle, store } = createRequestHandler({ dataDir, quiet: true });
  try {
    const response = await handle({
      method: "POST",
      url: "/__sink/api/error-analysis",
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ error })),
    });
    assert.equal(response.status, 503);
  } finally {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
