import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { H5SourceCatalog } from "./h5-source-catalog.js";

const execFile = promisify(execFileCallback);
const credentialHelper = fileURLToPath(
  new URL("../scripts/git-credential-env.sh", import.meta.url),
);

export class GitSourceUnavailableError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "GitSourceUnavailableError";
    this.code = "H5_GIT_SOURCE_UNAVAILABLE";
    this.cause = cause;
  }
}

function rejectUnsafeText(value, label, max = 2048) {
  if (typeof value !== "string" || value.length === 0 || value.length > max)
    throw new TypeError(`${label} is required`);
  if (value.includes("\0") || /[\r\n]/.test(value))
    throw new TypeError(`${label} contains an unsafe character`);
  return value;
}

function normalizeRepositoryUrl(value) {
  const url = rejectUnsafeText(value, "repository URL");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError("repository URL must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new TypeError("repository URL must use HTTP(S)");
  // Credentials belong in server environment variables. Embedding them in the
  // URL would expose them through process lists, logs and remote comparisons.
  if (parsed.username || parsed.password)
    throw new TypeError("repository URL must not contain credentials");
  if (parsed.hash || parsed.search)
    throw new TypeError("repository URL must not contain query or fragment");
  return parsed.href;
}

function normalizeBranch(value) {
  const branch = rejectUnsafeText(value, "branch", 256);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes("..") ||
    branch.endsWith(".lock") ||
    branch.endsWith("/")
  )
    throw new TypeError("branch contains an unsafe Git ref");
  return branch;
}

function normalizeWorktree(value) {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("worktree is required");
  return resolve(value);
}

function normalizeAppsDir(value) {
  const clean = rejectUnsafeText(value, "apps directory", 256)
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  const parts = clean.split("/").filter(Boolean);
  if (
    !parts.length ||
    parts.some((part) => part === "." || part === "..") ||
    clean.includes("\0")
  )
    throw new TypeError("apps directory contains an unsafe path");
  return parts.join("/");
}

export class GitH5SourceCatalog {
  constructor({
    repoUrl,
    branch = "PageAnalysis",
    worktree,
    appsDir = "apps",
    username = null,
    password = null,
    defaultApp,
    appMap = {},
    limits = {},
    refreshIntervalMs = 60_000,
    refreshFailureRetryMs = 5 * 60 * 1000,
    now = () => Date.now(),
    runGit = execFile,
    logger = null,
  } = {}) {
    this.repoUrl = normalizeRepositoryUrl(repoUrl);
    this.branch = normalizeBranch(branch);
    this.worktree = normalizeWorktree(worktree);
    this.appsDir = normalizeAppsDir(appsDir);
    this.username =
      username == null || username === ""
        ? null
        : rejectUnsafeText(username, "Git username", 256);
    this.password =
      password == null || password === ""
        ? null
        : rejectUnsafeText(password, "Git password", 2048);
    if ((this.username == null) !== (this.password == null))
      throw new TypeError("Git username and password must be set together");
    this.refreshIntervalMs = Math.max(0, Number(refreshIntervalMs) || 0);
    this.refreshFailureRetryMs = Math.max(
      1_000,
      Number(refreshFailureRetryMs) || 5 * 60 * 1000,
    );
    this.logger = typeof logger === "function" ? logger : () => {};
    this.nextSyncAt = 0;
    this.lastSyncError = null;
    this.now = now;
    this.runGit = runGit;
    this.syncPromise = null;
    this.lastSyncAt = 0;
    this.ready = false;
    // Reuse every path, symlink, extension, file-size and scan limit owned by
    // the local catalog. Git only changes where that rooted directory lives.
    this.delegate = new H5SourceCatalog({
      appsRoot: resolve(this.worktree, this.appsDir),
      defaultApp,
      appMap,
      limits,
    });
  }

  get configured() {
    return this.delegate.configured && Boolean(this.repoUrl);
  }

  async prepare() {
    if (this.ready && this.now() < this.nextSyncAt) return;
    if (this.ready && this.now() - this.lastSyncAt < this.refreshIntervalMs)
      return;
    this.syncPromise ??= this.sync().finally(() => {
      this.syncPromise = null;
    });
    await this.syncPromise;
  }

  async #git(directory, args) {
    const helperEnabled = Boolean(this.username && this.password);
    try {
      return await this.runGit("git", args, {
        cwd: directory,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/local/bin",
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          ...(helperEnabled
            ? {
                UMENG_SINK_GIT_CREDENTIAL_HELPER: "1",
                UMENG_SINK_GIT_USERNAME: this.username,
                UMENG_SINK_GIT_PASSWORD: this.password,
              }
            : {}),
        },
      });
    } catch (error) {
      // Git stderr can contain repository metadata. Keep it as cause for
      // server diagnostics, but never return it through the HTTP API.
      throw new GitSourceUnavailableError("Git source update failed", error);
    }
  }

  #gitArguments(args) {
    // An empty helper value clears system/global helpers before adding the
    // environment-backed helper, preventing accidental credential access.
    // This applies to clone too: the helper receives credentials from env,
    // never from the URL or argv.
    return [
      "-c",
      "credential.helper=",
      "-c",
      `credential.helper=${credentialHelper}`,
      ...args,
    ];
  }

  async #clone() {
    const parent = dirname(this.worktree);
    await fs.mkdir(parent, { recursive: true });
    const temporary = `${this.worktree}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      await this.#git(
        parent,
        this.#gitArguments([
          "clone",
          "--depth",
          "1",
          "--single-branch",
          "--branch",
          this.branch,
          this.repoUrl,
          temporary,
        ]),
      );
      await fs.rename(temporary, this.worktree);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
      if (error instanceof GitSourceUnavailableError) throw error;
      throw new GitSourceUnavailableError("Git source checkout failed", error);
    }
  }

  async #validateOwnedCheckout() {
    let stat;
    try {
      // lstat prevents a swapped symlink from directing git reset/clean at a
      // directory outside the configured server-owned checkout path.
      stat = await fs.lstat(this.worktree);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw new GitSourceUnavailableError(
        "Git source checkout is not accessible",
        error,
      );
    }
    if (!stat.isDirectory())
      throw new GitSourceUnavailableError(
        "Git source checkout path is not a directory",
      );
    const remote = await this.#git(this.worktree, [
      "remote",
      "get-url",
      "origin",
    ]);
    if (remote.stdout.trim() !== this.repoUrl)
      throw new GitSourceUnavailableError(
        "Git source checkout belongs to another repository",
      );
    return true;
  }

  async #refresh() {
    await this.#git(
      this.worktree,
      this.#gitArguments([
        "fetch",
        "--depth",
        "1",
        "--force",
        "--prune",
        "origin",
        this.branch,
      ]),
    );
    await this.#git(this.worktree, ["checkout", "--force", this.branch]);
    await this.#git(this.worktree, ["reset", "--hard", "FETCH_HEAD"]);
    // Only an unforced clean is needed: source catalog ignores ignored files,
    // and this avoids the broader behavior of clean -x on server storage.
    await this.#git(this.worktree, ["clean", "-fd"]);
  }

  async sync() {
    if (await this.#validateOwnedCheckout()) {
      try {
        await this.#refresh();
      } catch (error) {
        // A transient fetch failure must not make an already-owned checkout
        // unavailable (including after a service restart). Keep serving the
        // last successful revision, then retry after a bounded backoff instead
        // of on every analysis request.
        this.lastSyncError = error;
        this.lastSyncAt = this.now();
        this.nextSyncAt = this.now() + this.refreshFailureRetryMs;
        this.ready = true;
        this.logger(
          `[umeng-sink] git source refresh failed; reusing existing checkout (retry in ${Math.round(this.refreshFailureRetryMs / 1000)}s)`,
        );
        return;
      }
    } else {
      await this.#clone();
    }
    this.ready = true;
    this.lastSyncAt = this.now();
    this.lastSyncError = null;
    this.nextSyncAt = 0;
  }

  resolveApp(app) {
    return this.delegate.resolveApp(app);
  }

  resolveFile(app, file) {
    return this.delegate.resolveFile(app, file);
  }

  async readSnippet(app, file, line, column) {
    await this.prepare();
    return this.delegate.readSnippet(app, file, line, column);
  }

  async listFiles(app) {
    await this.prepare();
    return this.delegate.listFiles(app);
  }

  async sourceVersion(app) {
    await this.prepare();
    return this.delegate.sourceVersion(app);
  }

  status() {
    return {
      configured: this.configured,
      branch: this.branch,
      repository: this.repoUrl,
      ready: this.ready,
      ...this.delegate.status(),
      mode: "git",
      refreshFailed: Boolean(this.lastSyncError),
    };
  }
}

export { normalizeRepositoryUrl };
