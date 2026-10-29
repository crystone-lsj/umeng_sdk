/**
 * Provider-neutral contract for server-side error analysis.
 *
 * Providers receive bounded, already-selected source candidates and must return
 * only a decision about one candidate. They never own source-path resolution.
 */

export class AiProviderError extends Error {
  constructor(message, code = "AI_PROVIDER_ERROR", options = {}) {
    super(message, options);
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.status = options.status ?? null;
  }
}

export function assertAiDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiProviderError(
      "AI response must be an object",
      "AI_INVALID_RESPONSE",
    );
  }
  const status = value.status;
  if (status !== "selected" && status !== "uncertain") {
    throw new AiProviderError(
      "AI response has an invalid status",
      "AI_INVALID_RESPONSE",
    );
  }
  if (
    status === "selected" &&
    (!Number.isSafeInteger(value.candidateIndex) || value.candidateIndex < 0)
  ) {
    throw new AiProviderError(
      "AI response has an invalid candidate index",
      "AI_INVALID_RESPONSE",
    );
  }
  const confidence = value.confidence == null ? "low" : value.confidence;
  if (!["high", "medium", "low"].includes(confidence)) {
    throw new AiProviderError(
      "AI response has an invalid confidence",
      "AI_INVALID_RESPONSE",
    );
  }
  return {
    status,
    candidateIndex: status === "selected" ? value.candidateIndex : null,
    reason: typeof value.reason === "string" ? value.reason.slice(0, 1000) : "",
    confidence,
  };
}

export function createUnavailableAiProvider() {
  return {
    configured: false,
    async analyzeError() {
      throw new AiProviderError(
        "AI analysis is not configured",
        "AI_NOT_CONFIGURED",
      );
    },
  };
}
