import assert from "node:assert/strict";
import test from "node:test";

import {
  createCcswitchProvider,
  DEFAULT_TIMEOUT_MS,
} from "../src/ccswitch-provider.js";

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("CC Switch provider sends a bounded Responses request and parses output_text", async () => {
  let request;
  const provider = createCcswitchProvider({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1/",
    model: "test-model",
    reasoningEffort: "low",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return response({
        output_text:
          '{"status":"selected","candidateIndex":1,"reason":"match","confidence":"high"}',
      });
    },
  });

  const result = await provider.analyzeError({
    candidates: [{ index: 0 }, { index: 1 }],
  });
  assert.deepEqual(result, {
    status: "selected",
    candidateIndex: 1,
    reason: "match",
    confidence: "high",
  });
  assert.equal(request.url, "https://example.test/v1/responses");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.equal(request.body.model, "test-model");
  assert.deepEqual(request.body.reasoning, { effort: "low" });
});

test("CC Switch provider defaults to a two-minute timeout", async () => {
  const provider = createCcswitchProvider({
    apiKey: "test-key",
    fetchImpl: async () =>
      response({
        output_text:
          '{"status":"uncertain","reason":"wait","confidence":"low"}',
      }),
  });
  assert.equal(provider.configured, true);
  assert.equal(DEFAULT_TIMEOUT_MS, 120000);
});

test("CC Switch provider accepts nested response content and JSON fences", async () => {
  const provider = createCcswitchProvider({
    apiKey: "test-key",
    fetchImpl: async () =>
      response({
        output: [
          {
            content: [
              {
                text: '```json\n{"status":"uncertain","reason":"不确定","confidence":"low"}\n```',
              },
            ],
          },
        ],
      }),
  });
  assert.deepEqual(await provider.analyzeError({}), {
    status: "uncertain",
    candidateIndex: null,
    reason: "不确定",
    confidence: "low",
  });
});

test("CC Switch provider classifies auth and upstream failures without exposing credentials", async () => {
  for (const [status, code] of [
    [401, "AI_AUTH_ERROR"],
    [429, "AI_RATE_LIMITED"],
    [503, "AI_UPSTREAM_ERROR"],
  ]) {
    const provider = createCcswitchProvider({
      apiKey: "secret-test-key",
      fetchImpl: async () => response({}, status),
    });
    await assert.rejects(
      provider.analyzeError({}),
      (error) =>
        error.code === code && !error.message.includes("secret-test-key"),
    );
  }
});
