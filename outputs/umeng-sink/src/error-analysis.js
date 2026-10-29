import { createHash, randomUUID } from "node:crypto";

import { AiProviderError } from "./ai-provider.js";
import { findH5SourceCandidates } from "./h5-source-search.js";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;

function stringOrNull(value, max = 512) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeError(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("error must be an object");
  const error = {
    eventId: stringOrNull(input.eventId, 256),
    errorKey: stringOrNull(input.errorKey, 256),
    app: stringOrNull(input.app ?? input.appName, 128),
    name: stringOrNull(input.name, 128),
    message: stringOrNull(input.message, MAX_MESSAGE),
    file: stringOrNull(input.file, 2048),
    line: positiveInteger(input.line),
    column: positiveInteger(input.column),
    stack: stringOrNull(input.stack, MAX_STACK),
    page: stringOrNull(input.page, 2048),
  };
  if (!error.file || !error.line)
    throw new TypeError("error.file and error.line are required");
  return error;
}

function fingerprint(error, app) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        app,
        name: error.name,
        message: error.message,
        file: error.file,
        line: error.line,
        column: error.column,
        stack: error.stack,
        page: error.page,
      }),
    )
    .digest("hex");
}

function publicCandidate(candidate) {
  return {
    file: candidate.file,
    line: candidate.line,
    column: candidate.column,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    lines: candidate.lines,
    matchReason: candidate.matchReason,
  };
}

function precisionFor(candidate) {
  if (candidate?.matchReason?.includes("find_result_access"))
    return "route_expression_inference";
  if (candidate?.matchReason?.startsWith("route_")) return "route_inference";
  return "candidate_inference";
}

export class ErrorAnalysisService {
  constructor({
    catalog,
    provider,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    ttlMs = DEFAULT_TTL_MS,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    now = () => Date.now(),
    logger = null,
  } = {}) {
    this.catalog = catalog;
    this.provider = provider;
    this.maxConcurrent = Math.max(
      1,
      Math.min(8, Number(maxConcurrent) || DEFAULT_MAX_CONCURRENT),
    );
    this.ttlMs = Math.max(30_000, Number(ttlMs) || DEFAULT_TTL_MS);
    this.cacheTtlMs = Math.max(
      30_000,
      Number(cacheTtlMs) || DEFAULT_CACHE_TTL_MS,
    );
    this.now = now;
    this.logger = typeof logger === "function" ? logger : () => {};
    this.jobs = new Map();
    this.cache = new Map();
    this.queue = [];
    this.running = 0;
  }

  get configured() {
    return Boolean(this.provider?.configured && this.catalog?.configured);
  }

  status() {
    this.cleanup();
    return {
      configured: this.configured,
      queued: this.queue.length,
      running: this.running,
      jobs: this.jobs.size,
    };
  }

  cleanup() {
    const now = this.now();
    for (const [id, job] of this.jobs)
      if (now - job.updatedAt > this.ttlMs) this.jobs.delete(id);
    for (const [key, entry] of this.cache)
      if (now - entry.createdAt > this.cacheTtlMs) this.cache.delete(key);
  }

  create(input) {
    this.cleanup();
    if (!this.configured)
      throw new AiProviderError(
        "AI analysis is not configured",
        "AI_NOT_CONFIGURED",
      );
    const error = normalizeError(input?.error ?? input);
    const app = error.app ?? this.catalog.defaultApp;
    const cacheKey = fingerprint(error, app);
    const cached = this.cache.get(cacheKey);
    const job = {
      jobId: randomUUID(),
      status: cached ? "completed" : "queued",
      error,
      app,
      cacheKey,
      createdAt: this.now(),
      updatedAt: this.now(),
      result: cached?.result ?? null,
      errorMessage: null,
    };
    this.jobs.set(job.jobId, job);
    if (cached) return this.publicJob(job);
    this.queue.push(job);
    this.pump();
    return this.publicJob(job);
  }

  get(jobId) {
    this.cleanup();
    const job = this.jobs.get(jobId);
    return job ? this.publicJob(job) : null;
  }

  publicJob(job) {
    return {
      jobId: job.jobId,
      status: job.status,
      result: job.result,
      error: job.status === "failed" ? job.errorMessage : null,
    };
  }

  pump() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      this.running += 1;
      this.run(job).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  async run(job) {
    job.status = "running";
    job.updatedAt = this.now();
    try {
      const found = await findH5SourceCandidates(this.catalog, {
        app: job.app,
        file: job.error.file,
        line: job.error.line,
        column: job.error.column,
        message: job.error.message,
        stack: job.error.stack,
        page: job.error.page,
      });
      if (found.candidates.length === 0) {
        job.result = {
          status: "uncertain",
          reason: "未找到可供判断的本地源码候选",
          confidence: "low",
          precision: "candidate_inference",
          sourceVersion: await this.catalog.sourceVersion(job.app),
        };
      } else {
        const sourceVersion = await this.catalog.sourceVersion(job.app);
        const decision = await this.provider.analyzeError({
          error: job.error,
          project: { name: job.app, revision: sourceVersion },
          signals: found.signals,
          candidates: found.candidates.map((candidate, index) => ({
            index,
            ...publicCandidate(candidate),
          })),
        });
        if (
          decision.status === "selected" &&
          decision.candidateIndex < found.candidates.length
        ) {
          const candidate = found.candidates[decision.candidateIndex];
          job.result = {
            status: "selected",
            ...publicCandidate(candidate),
            reason: decision.reason,
            confidence: decision.confidence,
            precision: precisionFor(candidate),
            sourceVersion,
          };
        } else {
          job.result = {
            status: "uncertain",
            reason: decision.reason || "AI 无法在候选中确定错误位置",
            confidence: decision.confidence,
            precision: "candidate_inference",
            sourceVersion,
          };
        }
      }
      job.status = "completed";
      job.updatedAt = this.now();
      this.cache.set(job.cacheKey, {
        createdAt: this.now(),
        result: job.result,
      });
    } catch (error) {
      job.status = "failed";
      job.updatedAt = this.now();
      job.errorMessage =
        error instanceof AiProviderError && error.code === "AI_NOT_CONFIGURED"
          ? "AI 分析未配置"
          : "AI 分析暂时失败";
      this.logger(
        `[umeng-sink] error analysis failed: ${error?.code ?? "unknown"}`,
      );
    }
  }
}

export { fingerprint, normalizeError };
