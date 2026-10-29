import assert from "node:assert/strict";
import test from "node:test";

import { AiProviderError, assertAiDecision } from "../src/ai-provider.js";

test("AI decisions are reduced to the bounded provider contract", () => {
  assert.deepEqual(
    assertAiDecision({
      status: "selected",
      candidateIndex: 2,
      reason: "message matches the selected source line",
      confidence: "medium",
      ignored: "not returned",
    }),
    {
      status: "selected",
      candidateIndex: 2,
      reason: "message matches the selected source line",
      confidence: "medium",
    },
  );

  assert.deepEqual(
    assertAiDecision({ status: "uncertain", candidateIndex: 99 }),
    {
      status: "uncertain",
      candidateIndex: null,
      reason: "",
      confidence: "low",
    },
  );
});

test("invalid AI decisions fail closed", () => {
  assert.throws(
    () => assertAiDecision({ status: "selected", candidateIndex: -1 }),
    (error) =>
      error instanceof AiProviderError && error.code === "AI_INVALID_RESPONSE",
  );
  assert.throws(
    () =>
      assertAiDecision({
        status: "selected",
        candidateIndex: 0,
        confidence: "certain",
      }),
    (error) =>
      error instanceof AiProviderError && error.code === "AI_INVALID_RESPONSE",
  );
});
