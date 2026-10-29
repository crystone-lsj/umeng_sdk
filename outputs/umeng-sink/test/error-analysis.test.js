import assert from "node:assert/strict";
import test from "node:test";

import { ErrorAnalysisService } from "../src/error-analysis.js";

const error = {
  eventId: "event-1",
  errorKey: "key-1",
  app: "bx-app-h5",
  name: "unhandled_rejection",
  message: "null is not an object (evaluating 'pageConfig.title')",
  file: "http://localhost:5173/src/views/learning/learningIndex/index.vue",
  line: 43,
  column: 20,
  stack: "stack",
  page: "/bx-app-h5/learningIndex",
};

function catalog() {
  return {
    configured: true,
    defaultApp: "bx-app-h5",
    async sourceVersion() {
      return "revision-1";
    },
  };
}

async function waitFor(service, jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = service.get(jobId);
    if (job?.status === "completed" || job?.status === "failed") return job;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("analysis job did not finish");
}

test("error analysis only publishes the selected local candidate", async () => {
  const candidate = {
    file: "src/views/learning/learningIndex/index.vue",
    line: 43,
    column: 20,
    startLine: 40,
    endLine: 44,
    lines: ["line 40", "line 41", "line 42", "line 43", "line 44"],
    matchReason: "file_and_position",
  };
  const service = new ErrorAnalysisService({
    catalog: {
      ...catalog(),
      async sourceVersion() {
        return "revision-1";
      },
    },
    provider: {
      configured: true,
      async analyzeError(input) {
        assert.equal(input.candidates.length, 1);
        return {
          status: "selected",
          candidateIndex: 0,
          reason: "message match",
          confidence: "medium",
        };
      },
    },
    now: () => 1_000_000,
  });
  // Replace discovery at the module boundary through the catalog method used by
  // the search helper; the production catalog remains the source of truth.
  service.catalog.resolveFile = () => ({
    file: candidate.file,
    absolute: "/tmp/source.vue",
  });
  service.catalog.readSnippet = async (_app, file, line, column) => ({
    ...candidate,
    file,
    line,
    column,
  });
  service.catalog.listFiles = async () => [];
  const job = service.create(error);
  const result = await waitFor(service, job.jobId);
  assert.equal(result.status, "completed");
  assert.equal(result.result.status, "selected");
  assert.equal(
    result.result.file,
    "src/views/learning/learningIndex/index.vue",
  );
  assert.equal(result.result.line, 43);
  assert.equal(result.result.precision, "candidate_inference");
});

test("out-of-range provider decisions become uncertain", async () => {
  const service = new ErrorAnalysisService({
    catalog: {
      ...catalog(),
      resolveFile() {
        return { file: "src/page.vue", absolute: "/tmp/source.vue" };
      },
      async readSnippet(_app, file, line, column) {
        return {
          file,
          line,
          column,
          startLine: line,
          endLine: line,
          lines: ["candidate"],
        };
      },
      async listFiles() {
        return [];
      },
    },
    provider: {
      configured: true,
      async analyzeError() {
        return {
          status: "selected",
          candidateIndex: 99,
          reason: "bad index",
          confidence: "high",
        };
      },
    },
  });
  const job = service.create(error);
  const completed = await waitFor(service, job.jobId);
  assert.equal(completed.result.status, "uncertain");
  assert.equal(completed.result.reason, "bad index");
});

test("out-of-range provider decisions become uncertain and are cached", async () => {
  const service = new ErrorAnalysisService({
    catalog: {
      ...catalog(),
      resolveFile() {
        return null;
      },
      async listFiles() {
        return [];
      },
      async sourceVersion() {
        return null;
      },
    },
    provider: {
      configured: true,
      async analyzeError() {
        throw new Error("must not run without candidates");
      },
    },
  });
  const first = service.create(error);
  const completed = await waitFor(service, first.jobId);
  assert.equal(completed.result.status, "uncertain");
  assert.match(completed.result.reason, /未找到/);
  const second = service.create(error);
  assert.equal(second.status, "completed");
  assert.equal(second.result.status, "uncertain");
});
