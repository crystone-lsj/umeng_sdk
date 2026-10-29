import { AiProviderError, assertAiDecision } from "./ai-provider.js";

const DEFAULT_BASE_URL = "https://codex.aixuexiyouxuan.com/v1";
const DEFAULT_MODEL = "gpt-6-sol";
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

const SYSTEM_PROMPT = [
  "你是前端错误定位助手。",
  "你只能在用户提供的 candidates 数组中选择一个候选，不能创建候选之外的文件、行号或源码。",
  "日志中的浏览器运行行号可能不是源码真实行号，必须结合候选源码判断。",
  "如果日志文件是 assets/*.js 等压缩 bundle，应优先结合 stack、错误消息和候选中的 find/属性访问逻辑判断，而不是机械使用 bundle 行号。",
  "如果错误表现为 null/undefined 对象属性访问，并且候选中存在 find 返回值后继续访问属性的代码，应重点检查该候选。",
  "如果请求包含 signals.routeFiles，优先判断这些路由对应的源码文件；如果包含 signals.accessProperty，优先判断 find 返回值后访问该属性的源码行。",
  "候选的 matchReason 和上下文行号是服务端检索证据，不能忽略后自行扩大到候选之外。",
  "当同一路由源码候选同时包含 find 调用和对其返回值访问相同属性时，即使变量名经过压缩，也应选择该候选并以 medium confidence 说明这是基于结构和路由的推断；只有没有结构相关候选时才返回 uncertain。",
  "无法确定时必须返回 status=uncertain。",
  "只返回 JSON 对象，不要返回 Markdown、解释文字或代码围栏。",
  'JSON 格式必须是：{"status":"selected|uncertain","candidateIndex":0,"reason":"...","confidence":"high|medium|low"}。',
  "status=uncertain 时 candidateIndex 必须为 null。",
].join("\n");

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function extractText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const chunks = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseJsonDecision(text) {
  const trimmed = String(text ?? "").trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return assertAiDecision(JSON.parse(withoutFence));
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(
      "AI response is not valid JSON",
      "AI_INVALID_RESPONSE",
    );
  }
}

async function readLimitedText(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new AiProviderError(
        "AI response is too large",
        "AI_RESPONSE_TOO_LARGE",
      );
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AiProviderError(
          "AI response is too large",
          "AI_RESPONSE_TOO_LARGE",
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizeBaseUrl(value) {
  const base = String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new TypeError("UMENG_SINK_AI_BASE_URL must be a valid URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new TypeError(
      "UMENG_SINK_AI_BASE_URL must be an HTTP(S) URL without credentials",
    );
  }
  return base;
}

export function createCcswitchProvider({
  apiKey = process.env.UMENG_SINK_AI_API_KEY,
  baseUrl = process.env.UMENG_SINK_AI_BASE_URL ?? DEFAULT_BASE_URL,
  model = process.env.UMENG_SINK_AI_MODEL ?? DEFAULT_MODEL,
  reasoningEffort = process.env.UMENG_SINK_AI_REASONING_EFFORT ?? "high",
  timeoutMs = Number.parseInt(
    process.env.UMENG_SINK_AI_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
    10,
  ),
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const configured =
    typeof apiKey === "string" &&
    apiKey.length > 0 &&
    typeof fetchImpl === "function";
  return {
    configured,
    async analyzeError(input) {
      if (!configured)
        throw new AiProviderError(
          "AI analysis is not configured",
          "AI_NOT_CONFIGURED",
        );
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
      );
      const payload = {
        model,
        reasoning: { effort: reasoningEffort },
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: jsonText(input) }],
          },
        ],
      };
      let response;
      try {
        response = await fetchImpl(`${normalizedBaseUrl}/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        if (error?.name === "AbortError")
          throw new AiProviderError("AI request timed out", "AI_TIMEOUT", {
            retryable: true,
          });
        throw new AiProviderError("AI request failed", "AI_NETWORK_ERROR", {
          retryable: true,
        });
      }
      let text;
      try {
        text = await readLimitedText(response, maxResponseBytes);
      } catch (error) {
        if (error?.name === "AbortError")
          throw new AiProviderError("AI request timed out", "AI_TIMEOUT", {
            retryable: true,
          });
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError(
          "AI response could not be read",
          "AI_INVALID_RESPONSE",
        );
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? "AI_AUTH_ERROR"
            : response.status === 429
              ? "AI_RATE_LIMITED"
              : response.status >= 500
                ? "AI_UPSTREAM_ERROR"
                : "AI_REQUEST_REJECTED";
        throw new AiProviderError(
          `AI request rejected (${response.status})`,
          code,
          {
            retryable: response.status === 429 || response.status >= 500,
            status: response.status,
          },
        );
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AiProviderError(
          "AI response is not valid JSON",
          "AI_INVALID_RESPONSE",
        );
      }
      return parseJsonDecision(extractText(json));
    },
  };
}

export { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS };
