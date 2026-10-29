import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findH5SourceCandidates } from "../src/h5-source-search.js";

test("source search returns bounded inference candidates", async () => {
  const catalog = {
    configured: true,
    defaultApp: "bx-app-h5",
    resolveApp() {
      return { target: "bx-app-h5" };
    },
    resolveFile() {
      return {
        app: "bx-app-h5",
        file: "src/page.vue",
        absolute: "/tmp/page.vue",
      };
    },
    async readSnippet(_app, file, line, column) {
      return {
        app: "bx-app-h5",
        file,
        line,
        column,
        startLine: line,
        endLine: line,
        lines: [`line ${line}`],
      };
    },
    async listFiles() {
      return [];
    },
  };
  const result = await findH5SourceCandidates(catalog, {
    file: "http://localhost:5173/src/page.vue",
    line: 12,
    column: 3,
    message: "null is not an object (evaluating 'pageConfig.title')",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.precision, "candidate_inference");
  assert.equal(result.candidates[0].matchReason, "file_and_position");
});

test("source search reports unavailable when the local catalog is not configured", async () => {
  const result = await findH5SourceCandidates(
    { configured: false },
    { file: "src/page.vue", line: 1 },
  );
  assert.deepEqual(result, {
    status: "unavailable",
    reason: "source_catalog_not_configured",
    candidates: [],
  });
});

test("source search uses stack find signals to discover the source after a bundle position", async () => {
  const source = [
    "const sections = Object.values(config);",
    "const currentSection = sections.find((section) => section.key === name);",
    "currentSection.title;",
  ].join("\n");
  const root = await mkdtemp(join(tmpdir(), "umeng-sink-source-search-"));
  const sourcePath = join(root, "learning.vue");
  await writeFile(sourcePath, source, "utf8");
  const catalog = {
    configured: true,
    defaultApp: "bx-app-h5",
    resolveApp() {
      return { target: "bx-app-h5" };
    },
    resolveFile() {
      return null;
    },
    async readSnippet(_app, file, line, column) {
      return {
        app: "bx-app-h5",
        file,
        line,
        column,
        startLine: line,
        endLine: line,
        lines: source.split("\n").slice(Math.max(0, line - 1), line),
      };
    },
    async listFiles() {
      return [
        {
          file: "src/views/learning/learningIndex/index.vue",
          absolute: sourcePath,
        },
      ];
    },
  };
  try {
    const result = await findH5SourceCandidates(catalog, {
      file: "http://localhost:5173/assets/index.js",
      line: 1234,
      column: 56,
      message: "null is not an object (evaluating 'pageConfig.title')",
      stack: "at Array.find (assets/index.js:1234:56)",
      page: "/bx-app-h5/learningIndex",
    });
    assert.equal(result.status, "ready");
    assert.ok(result.signals.find);
    assert.ok(result.candidates.some((candidate) => candidate.line === 2));
    assert.ok(result.candidates.some((candidate) => candidate.line === 3));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("source search prioritizes the route source and find-result property access", async () => {
  const source = [
    "const renderState = { revision: revision.value, lessons: lessons.value };",
    "if (renderState.revision > 0) {",
    "  const renderTarget = [renderState].find(({ revision }) => revision < 0);",
    "  return renderTarget.value.lessons;",
    "}",
  ].join("\n");
  const root = await mkdtemp(join(tmpdir(), "umeng-sink-route-search-"));
  const sourcePath = join(root, "lessonDetail.vue");
  await writeFile(sourcePath, source, "utf8");
  const catalog = {
    configured: true,
    defaultApp: "bx-app-h5",
    resolveApp() {
      return { target: "bx-app-h5" };
    },
    resolveFile(_app, file) {
      return file === "src/views/learning/lessonDetail/index.vue"
        ? { app: "bx-app-h5", file, absolute: sourcePath }
        : null;
    },
    async readSnippet(_app, file, line, column) {
      return {
        app: "bx-app-h5",
        file,
        line,
        column,
        startLine: line,
        endLine: line,
        lines: source.split("\n").slice(Math.max(0, line - 1), line),
      };
    },
    async listFiles() {
      return [
        {
          file: "src/views/learning/lessonDetail/index.vue",
          absolute: sourcePath,
        },
      ];
    },
  };
  try {
    const result = await findH5SourceCandidates(catalog, {
      file: "https://q-fe.aixuexi.com/operation-system/bx-app-h5/assets/index.js",
      line: 1,
      column: 15728,
      message:
        "undefined is not an object (evaluating '[e].find(({revision:e})=>e<0).value')",
      stack:
        "https://q-fe.aixuexi.com/operation-system/bx-app-h5/assets/index.js:1:15728",
      page: "/bx-app-h5/lessonDetail",
    });
    assert.equal(result.signals.accessProperty, "value");
    assert.deepEqual(result.signals.routeFiles, [
      "src/views/learning/lessonDetail/index.vue",
    ]);
    assert.equal(
      result.candidates[0].file,
      "src/views/learning/lessonDetail/index.vue",
    );
    assert.equal(result.candidates[0].line, 4);
    assert.equal(result.candidates[0].matchReason, "route_find_result_access");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
