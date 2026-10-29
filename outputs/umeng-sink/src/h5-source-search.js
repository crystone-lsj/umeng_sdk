import { readFile } from "node:fs/promises";

const MAX_CANDIDATES = 8;
const MAX_TERMS = 16;

const NULLISH_ERROR =
  /(?:null|undefined) is not an object|cannot read propert|cannot read properties/i;
const FIND_SIGNAL = /(?:\.find\s*\(|\bfind\s*\()/;

function textTerms(text) {
  if (typeof text !== "string") return [];
  const values = new Set();
  const quoted = text.match(/evaluating ['"]([^'"]+)['"]/i)?.[1];
  if (quoted) values.add(quoted);
  for (const token of text.split(/[^A-Za-z0-9_$.[\]]+/)) {
    const normalized = token.replace(/\]$/, "");
    if (
      normalized.length >= 4 &&
      /[A-Za-z_$]/.test(normalized) &&
      !/^(?:https?|assets|views|index|object|evaluating)$/i.test(normalized) &&
      !/\.(?:js|vue|ts|tsx|jsx)$/i.test(normalized)
    )
      values.add(normalized);
  }
  return [...values];
}

function messageTerms(message, stack) {
  const values = new Set([...textTerms(message), ...textTerms(stack)]);
  return [...values]
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_TERMS);
}

function stackLocations(stack) {
  if (typeof stack !== "string") return [];
  const locations = [];
  const pattern =
    /((?:https?:\/\/[^\s()[\]]+|[^\s()[\]]+\.(?:vue|jsx?|tsx?|mjs|cjs))):(\d+)(?::(\d+))?/gi;
  for (const match of stack.matchAll(pattern)) {
    const line = Number(match[2]);
    const column = match[3] == null ? 1 : Number(match[3]);
    if (
      Number.isSafeInteger(line) &&
      line > 0 &&
      Number.isSafeInteger(column) &&
      column > 0
    ) {
      locations.push({ file: match[1], line, column });
    }
  }
  return locations;
}

function sourceSignals(message, stack) {
  const combined = `${message ?? ""}\n${stack ?? ""}`;
  const accessProperty =
    combined.match(/\.find\b[\s\S]{0,240}?\.\s*([A-Za-z_$][\w$]*)\b/i)?.[1] ??
    null;
  return {
    nullish: NULLISH_ERROR.test(combined),
    find: FIND_SIGNAL.test(combined),
    accessProperty,
    compressedBundle: /(?:^|[\\/])assets[\\/][^\\s:]+\.js(?:$|:)/i.test(
      combined,
    ),
  };
}

function matchingLines(text, terms, signals) {
  const lines = String(text).split(/\r?\n/);
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index];
    let score = 0;
    const matchedTerms = terms.filter((term) => value.includes(term));
    score += matchedTerms.reduce(
      (total, term) => total + Math.min(24, term.length),
      0,
    );
    if (signals.find && FIND_SIGNAL.test(value)) score += 110;
    if (
      signals.nullish &&
      /\b(?:currentSection|pageConfig|pageData|courseList|student|renderTarget)\s*\./.test(
        value,
      )
    )
      score += 55;
    if (
      signals.find &&
      signals.accessProperty &&
      new RegExp(`\\.\\s*${signals.accessProperty}\\b`).test(value)
    ) {
      const preceding = lines.slice(Math.max(0, index - 3), index).join("\n");
      if (FIND_SIGNAL.test(preceding)) score += 150;
    }
    if (
      signals.find &&
      /\b(?:value|title|name|map)\b/.test(value) &&
      index > 0 &&
      FIND_SIGNAL.test(lines[index - 1])
    )
      score += 35;
    if (score > 0) matches.push({ line: index + 1, score, matchedTerms });
  }
  return matches.sort(
    (left, right) => right.score - left.score || left.line - right.line,
  );
}

function routeSourcePaths(page, appNames = []) {
  if (typeof page !== "string") return [];
  let pathname = page.split(/[?#]/, 1)[0].replaceAll("\\", "/");
  try {
    pathname = new URL(page, "http://localhost").pathname;
  } catch {
    /* Keep path-like route values. */
  }
  const parts = pathname.split("/").filter(Boolean);
  const knownAppNames = new Set([
    "bx-app-h5",
    "multi-h5",
    "teacher-h5",
    ...appNames,
  ]);
  const appIndex = parts.findIndex((part) => knownAppNames.has(part));
  if (appIndex >= 0) parts.splice(0, appIndex + 1);
  if (parts.length === 0) return [];
  const route = parts.join("/");
  const paths = new Set();
  const viewRoots = [
    "",
    "learning",
    "service",
    "marketing",
    "transfer",
    "trial",
    "classList",
    "classListSame",
  ];
  for (const root of viewRoots) {
    const prefix = root ? `${root}/` : "";
    paths.add(`src/views/${prefix}${route}/index.vue`);
    paths.add(`src/views/${prefix}${route}.vue`);
  }
  if (parts.length === 1) paths.add(`src/views/${parts[0]}/index.js`);
  return [...paths];
}

async function readFileCandidates(
  catalog,
  app,
  entry,
  terms,
  signals,
  reasonPrefix,
  scoreOffset = 0,
) {
  let text;
  try {
    text = await readFile(entry.absolute, "utf8");
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  const matches = matchingLines(text, terms, signals);
  const results = [];
  for (const match of matches.slice(0, MAX_CANDIDATES)) {
    const isAccess =
      signals.accessProperty &&
      new RegExp(`\\.\\s*${signals.accessProperty}\\b`).test(
        lines[match.line - 1],
      );
    const isFind = FIND_SIGNAL.test(lines[match.line - 1]);
    const reason = isAccess
      ? `${reasonPrefix}_find_result_access`
      : isFind
        ? `${reasonPrefix}_find_signal`
        : `${reasonPrefix}_message`;
    const candidate = await readCandidate(
      catalog,
      app,
      entry.file,
      match.line,
      1,
      reason,
      match.score + scoreOffset,
    );
    if (candidate) results.push(candidate);
  }
  return results;
}

async function readCandidate(
  catalog,
  app,
  file,
  line,
  column,
  matchReason,
  score = 0,
) {
  const snippet = await catalog.readSnippet(app, file, line, column);
  return snippet ? { ...snippet, matchReason, score } : null;
}

export async function findH5SourceCandidates(
  catalog,
  { app, file, line, column, message, stack, page } = {},
) {
  if (!catalog?.configured)
    return {
      status: "unavailable",
      reason: "source_catalog_not_configured",
      candidates: [],
    };
  const selectedApp = app ?? catalog.defaultApp;
  const candidates = new Map();
  const add = (candidate) => {
    if (!candidate) return;
    const key = `${candidate.file}:${candidate.line}`;
    const previous = candidates.get(key);
    if (!previous || candidate.score > previous.score)
      candidates.set(key, candidate);
  };

  const resolved = catalog.resolveFile(selectedApp, file);
  const terms = messageTerms(message, stack);
  const signals = sourceSignals(message, stack);
  const locations = stackLocations(stack);
  const routeCandidates = [];
  const resolvedApp = catalog.resolveApp?.(selectedApp);
  const routeAppNames = [
    selectedApp,
    resolvedApp?.target,
    resolvedApp?.directory?.split(/[\\/]/).pop(),
  ].filter(Boolean);
  for (const routeFile of routeSourcePaths(page, routeAppNames)) {
    const routeResolved = catalog.resolveFile(selectedApp, routeFile);
    if (!routeResolved) continue;
    try {
      await readFile(routeResolved.absolute, "utf8");
      routeCandidates.push(routeResolved);
    } catch {
      /* The route-to-view guess must point to a real local file. */
    }
  }
  if (resolved) {
    const byPosition = await readCandidate(
      catalog,
      selectedApp,
      resolved.file,
      line,
      column,
      "file_and_position",
      100,
    );
    add(byPosition);
    try {
      const text = await readFile(resolved.absolute, "utf8");
      const lines = text.split(/\r?\n/);
      for (const match of matchingLines(text, terms, signals).slice(
        0,
        MAX_CANDIDATES,
      )) {
        const reason =
          signals.find && FIND_SIGNAL.test(lines[match.line - 1])
            ? "file_and_stack_find_signal"
            : "file_and_message";
        add(
          await readCandidate(
            catalog,
            selectedApp,
            resolved.file,
            match.line,
            column,
            reason,
            match.score + 700,
          ),
        );
      }
    } catch {
      /* Candidate discovery remains best-effort. */
    }
  }

  for (const entry of routeCandidates) {
    for (const candidate of await readFileCandidates(
      catalog,
      selectedApp,
      entry,
      terms,
      signals,
      "route",
      500,
    ))
      add(candidate);
  }

  for (const location of locations) {
    const stackFile = catalog.resolveFile(selectedApp, location.file);
    if (!stackFile) continue;
    add(
      await readCandidate(
        catalog,
        selectedApp,
        stackFile.file,
        location.line,
        location.column,
        "stack_position",
        150,
      ),
    );
  }

  if (
    candidates.size < MAX_CANDIDATES &&
    (terms.length > 0 || signals.find || signals.nullish)
  ) {
    const files = await catalog.listFiles(selectedApp);
    const prioritized = [
      ...routeCandidates,
      ...files.filter(
        (entry) => !routeCandidates.some((route) => route.file === entry.file),
      ),
    ];
    for (const entry of prioritized) {
      if (candidates.size >= MAX_CANDIDATES) break;
      for (const candidate of await readFileCandidates(
        catalog,
        selectedApp,
        entry,
        terms,
        signals,
        "message",
        0,
      )) {
        if (candidates.size >= MAX_CANDIDATES) break;
        add(candidate);
      }
    }
  }

  const ordered = [...candidates.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.file.localeCompare(right.file) ||
        left.line - right.line,
    )
    .slice(0, MAX_CANDIDATES)
    .map(({ score, ...candidate }) => candidate);

  return {
    status: ordered.length ? "ready" : "not_found",
    // These are bounded inference candidates. They are not a Source Map
    // reconstruction and must be verified again before being shown as a result.
    precision: "candidate_inference",
    candidates: ordered,
    requested: { app: selectedApp, file, line, column, page },
    signals: {
      terms,
      ...signals,
      stackLocations: locations.length,
      routeFiles: routeCandidates.map((entry) => entry.file),
    },
  };
}
