import { execFile as execFileCallback } from "node:child_process";
import { promises as fs, readdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const SOURCE_EXTENSIONS = new Set([
  ".vue",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "prod",
  "dist",
  "coverage",
  ".cache",
]);
const IGNORED_APP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".cache",
]);
const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxScanFiles: 250,
  maxScanBytes: 8 * 1024 * 1024,
  maxSnippetLines: 9,
  maxLineBytes: 300,
});

function asSafeName(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128)
    return null;
  const clean = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (
    !clean ||
    clean.split("/").some((part) => !part || part === ".." || part === ".")
  )
    return null;
  return clean;
}

export function parseH5AppMap(value) {
  if (value == null || value === "") return {};
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new TypeError("UMENG_SINK_H5_APP_MAP must be valid JSON");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("UMENG_SINK_H5_APP_MAP must be an object");
  }
  const result = {};
  for (const [key, target] of Object.entries(parsed)) {
    const safeKey = asSafeName(key);
    const safeTarget = asSafeName(target);
    if (!safeKey || !safeTarget)
      throw new TypeError("UMENG_SINK_H5_APP_MAP contains an unsafe app path");
    result[safeKey] = safeTarget;
  }
  return result;
}

function discoverH5AppMap(appsRoot) {
  if (!appsRoot) return {};
  let entries;
  try {
    entries = readdirSync(appsRoot, { withFileTypes: true });
  } catch {
    return {};
  }
  const discovered = {};
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      IGNORED_APP_DIRECTORIES.has(entry.name)
    )
      continue;
    const safeName = asSafeName(entry.name);
    if (safeName && !safeName.startsWith(".")) discovered[safeName] = safeName;
  }
  return discovered;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function normalizeSourcePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    value.includes("\0")
  )
    return null;
  let pathname = value;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = value.split(/[?#]/, 1)[0];
  }
  const clean = pathname.replaceAll("\\", "/");
  const marker = clean.match(/(?:^|\/)(src|packages)\//);
  if (marker)
    pathname = clean.slice(marker.index + (marker[0].startsWith("/") ? 1 : 0));
  else pathname = clean.replace(/^\/+/, "");
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part === "."))
    return null;
  const relative = parts.join("/");
  return relative.startsWith("src/") || relative.startsWith("packages/")
    ? relative
    : null;
}

function sourceFile(value) {
  const relative = normalizeSourcePath(value);
  if (!relative || !SOURCE_EXTENSIONS.has(path.extname(relative).toLowerCase()))
    return null;
  return relative;
}

function clippedLine(value, maxLineBytes) {
  return String(value).slice(0, maxLineBytes);
}

function snippetFromText(text, line, column = 1, limits = DEFAULT_LIMITS) {
  const lines = String(text).split(/\r?\n/);
  if (!Number.isSafeInteger(line) || line < 1 || line > lines.length)
    return null;
  const startLine = Math.max(1, line - Math.floor(limits.maxSnippetLines / 2));
  const endLine = Math.min(
    lines.length,
    startLine + limits.maxSnippetLines - 1,
  );
  return {
    line,
    column: Number.isSafeInteger(column) && column > 0 ? column : 1,
    startLine,
    endLine,
    lines: lines
      .slice(startLine - 1, endLine)
      .map((value) => clippedLine(value, limits.maxLineBytes)),
  };
}

async function readGitRevision(cwd) {
  try {
    const result = await execFile("git", ["rev-parse", "HEAD"], {
      cwd,
      timeout: 1500,
      maxBuffer: 1024,
    });
    const revision = result.stdout.trim();
    return /^[0-9a-f]{7,64}$/i.test(revision) ? revision : null;
  } catch {
    return null;
  }
}

export class H5SourceCatalog {
  constructor({
    appsRoot,
    defaultApp = "bx-app-h5",
    appMap = {},
    limits = {},
  } = {}) {
    this.appsRoot = appsRoot ? path.resolve(appsRoot) : null;
    this.defaultApp = asSafeName(defaultApp) ?? "bx-app-h5";
    const explicitAppMap = parseH5AppMap(appMap);
    // Every direct project directory is addressable by its directory name.
    // Explicit aliases remain authoritative, e.g. "学什么" -> "bx-app-h5".
    this.appMap = { ...discoverH5AppMap(this.appsRoot), ...explicitAppMap };
    if (!Object.hasOwn(this.appMap, this.defaultApp))
      this.appMap[this.defaultApp] = this.defaultApp;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.revision = new Map();
  }

  get configured() {
    return Boolean(this.appsRoot);
  }

  resolveApp(app) {
    const requested = asSafeName(app) ?? this.defaultApp;
    if (!Object.hasOwn(this.appMap, requested)) return null;
    const mapped = this.appMap[requested];
    const safeTarget = asSafeName(mapped);
    if (!this.appsRoot || !safeTarget) return null;
    const root = path.resolve(this.appsRoot, safeTarget);
    return inside(this.appsRoot, root)
      ? { name: requested, target: safeTarget, directory: root }
      : null;
  }

  resolveFile(app, file) {
    const resolvedApp = this.resolveApp(app);
    const relative = sourceFile(file);
    if (!resolvedApp || !relative) return null;
    const absolute = path.resolve(resolvedApp.directory, relative);
    if (!inside(resolvedApp.directory, absolute)) return null;
    return { ...resolvedApp, file: relative, absolute };
  }

  async readSnippet(app, file, line, column) {
    const resolved = this.resolveFile(app, file);
    if (!resolved) return null;
    let stat;
    try {
      const [appsRootRealpath, rootRealpath, fileRealpath] = await Promise.all([
        fs.realpath(this.appsRoot),
        fs.realpath(resolved.directory),
        fs.realpath(resolved.absolute),
      ]);
      if (
        !inside(appsRootRealpath, rootRealpath) ||
        !inside(rootRealpath, fileRealpath)
      )
        return null;
      stat = await fs.stat(fileRealpath);
      if (!stat.isFile()) return null;
      resolved.absolute = fileRealpath;
    } catch {
      return null;
    }
    if (stat.size > this.limits.maxFileBytes) return null;
    let text;
    try {
      text = await fs.readFile(resolved.absolute, "utf8");
    } catch {
      return null;
    }
    const snippet = snippetFromText(text, line, column, this.limits);
    return snippet
      ? { app: resolved.name, file: resolved.file, ...snippet }
      : null;
  }

  async listFiles(app) {
    const resolved = this.resolveApp(app);
    if (!resolved) return [];
    let appsRootRealpath;
    let appRoot;
    try {
      [appsRootRealpath, appRoot] = await Promise.all([
        fs.realpath(this.appsRoot),
        fs.realpath(resolved.directory),
      ]);
    } catch {
      return [];
    }
    if (!inside(appsRootRealpath, appRoot)) return [];
    const files = [];
    let scannedBytes = 0;
    const walk = async (directory, relativeDirectory) => {
      if (
        files.length >= this.limits.maxScanFiles ||
        scannedBytes >= this.limits.maxScanBytes
      )
        return;
      let realDirectory;
      try {
        realDirectory = await fs.realpath(directory);
      } catch {
        return;
      }
      if (!inside(appRoot, realDirectory)) return;
      let entries;
      try {
        entries = await fs.readdir(realDirectory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          files.length >= this.limits.maxScanFiles ||
          scannedBytes >= this.limits.maxScanBytes
        )
          break;
        // Do not follow symlinked directories or files. A lexical path check is
        // not sufficient to prevent a symlink from escaping the project root.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(
            path.join(realDirectory, entry.name),
            path.posix.join(relativeDirectory, entry.name),
          );
          continue;
        }
        if (
          !entry.isFile() ||
          !SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        )
          continue;
        const absolute = path.join(realDirectory, entry.name);
        const relative = path.posix.join(relativeDirectory, entry.name);
        try {
          const realpath = await fs.realpath(absolute);
          if (!inside(appRoot, realpath)) continue;
          const stat = await fs.stat(absolute);
          if (stat.size > this.limits.maxFileBytes) continue;
          scannedBytes += stat.size;
          files.push({ file: relative, absolute: realpath, size: stat.size });
        } catch {
          /* A file can disappear while the catalog is scanning. */
        }
      }
    };
    for (const sourceDirectory of ["src", "packages"]) {
      const directory = path.join(resolved.directory, sourceDirectory);
      await walk(directory, sourceDirectory);
    }
    return files;
  }

  async sourceVersion(app) {
    const resolved = this.resolveApp(app);
    if (!resolved) return null;
    if (!this.revision.has(resolved.directory)) {
      this.revision.set(
        resolved.directory,
        (async () => {
          try {
            const [appsRootRealpath, appRoot] = await Promise.all([
              fs.realpath(this.appsRoot),
              fs.realpath(resolved.directory),
            ]);
            return inside(appsRootRealpath, appRoot)
              ? readGitRevision(appRoot)
              : null;
          } catch {
            return null;
          }
        })(),
      );
    }
    return this.revision.get(resolved.directory);
  }

  status() {
    const apps = Object.keys(this.appMap).sort();
    return {
      configured: this.configured,
      defaultApp: this.defaultApp,
      apps: apps.length > 0 ? apps : this.configured ? [this.defaultApp] : [],
    };
  }
}

export { normalizeSourcePath, sourceFile, snippetFromText, DEFAULT_LIMITS };
