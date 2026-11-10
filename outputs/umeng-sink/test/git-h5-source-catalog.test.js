import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GitH5SourceCatalog,
  GitSourceUnavailableError,
} from "../src/git-h5-source-catalog.js";

const repositoryUrl = "https://gitlab.example/business-fe/gs-vue.git";

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "umeng-git-catalog-"));
  const fixture = join(root, "fixture");
  try {
    const app = join(fixture, "apps", "bx-app-h5");
    await mkdir(join(app, "src/views"), { recursive: true });
    await writeFile(
      join(app, "src/views/page.vue"),
      "<template>\n  <div>source</div>\n</template>\n",
      "utf8",
    );
    await run({ root, fixture });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("git catalog clones a pinned branch and reads through the local catalog", async () => {
  await withFixture(async ({ root, fixture }) => {
    const worktree = join(root, "checkout");
    const commands = [];
    const catalog = new GitH5SourceCatalog({
      repoUrl: repositoryUrl,
      branch: "PageAnalysis",
      worktree,
      username: "ci-reader",
      password: "secret-token",
      refreshIntervalMs: Number.POSITIVE_INFINITY,
      runGit: async (command, args, options) => {
        commands.push({ command, cwd: options.cwd, args, env: options.env });
        if (args.includes("clone")) {
          const destination = args.at(-1);
          await cp(fixture, destination, { recursive: true });
        }
        return { stdout: "", stderr: "" };
      },
    });

    await catalog.prepare();
    const snippet = await catalog.readSnippet(
      "bx-app-h5",
      "src/views/page.vue",
      2,
      5,
    );

    assert.equal(snippet.file, "src/views/page.vue");
    assert.deepEqual(snippet.lines, [
      "<template>",
      "  <div>source</div>",
      "</template>",
      "",
    ]);
    const clone = commands.find((entry) => entry.args.includes("clone"));
    assert.ok(clone);
    assert.equal(clone.command, "git");
    assert.equal(clone.cwd, join(root, ""));
    assert.equal(clone.args.at(-2), repositoryUrl);
    assert.equal(clone.env.UMENG_SINK_GIT_CREDENTIAL_HELPER, "1");
    assert.equal(clone.env.UMENG_SINK_GIT_USERNAME, "ci-reader");
    assert.equal(clone.env.UMENG_SINK_GIT_PASSWORD, "secret-token");
    assert.ok(!JSON.stringify(commands).includes("secret-token="));
    assert.equal(catalog.status().mode, "git");
    assert.equal(catalog.status().ready, true);
    assert.equal(catalog.status().branch, "PageAnalysis");
    assert.equal(catalog.status().repository, repositoryUrl);
  });
});

test("git catalog refreshes an existing checkout owned by the configured remote", async () => {
  await withFixture(async ({ root, fixture }) => {
    const worktree = join(root, "checkout");
    await cp(fixture, worktree, { recursive: true });
    const commands = [];
    const catalog = new GitH5SourceCatalog({
      repoUrl: repositoryUrl,
      branch: "PageAnalysis",
      worktree,
      username: "ci-reader",
      password: "secret-token",
      refreshIntervalMs: 0,
      runGit: async (_command, args) => {
        commands.push(args);
        if (args.includes("remote")) return { stdout: `${repositoryUrl}\n` };
        return { stdout: "", stderr: "" };
      },
    });

    await catalog.prepare();
    assert.deepEqual(
      commands.map((args) =>
        args.includes("remote")
          ? "remote"
          : args.includes("fetch")
            ? "fetch"
            : args[0],
      ),
      ["remote", "fetch", "checkout", "reset", "clean"],
    );
    const fetch = commands.find((args) => args.includes("fetch"));
    assert.equal(fetch[0], "-c");
    assert.deepEqual(fetch.slice(-2), ["origin", "PageAnalysis"]);
    assert.ok(
      fetch.some(
        (value) =>
          typeof value === "string" && value.endsWith("/git-credential-env.sh"),
      ),
    );
  });
});

test("git catalog reuses an owned checkout when refresh fails and retries later", async () => {
  await withFixture(async ({ root, fixture }) => {
    const worktree = join(root, "checkout");
    await cp(fixture, worktree, { recursive: true });
    let time = 1_000;
    const messages = [];
    const catalog = new GitH5SourceCatalog({
      repoUrl: repositoryUrl,
      branch: "PageAnalysis",
      worktree,
      username: "ci-reader",
      password: "secret-token",
      refreshIntervalMs: 0,
      refreshFailureRetryMs: 1_000,
      now: () => time,
      logger: (message) => messages.push(message),
      runGit: async (_command, args) => {
        if (args.includes("remote")) return { stdout: `${repositoryUrl}\n` };
        if (args.includes("fetch") && time < 2_001)
          throw new Error("fatal: transient remote unavailable");
        return { stdout: "", stderr: "" };
      },
    });

    await catalog.prepare();
    const snippet = await catalog.readSnippet(
      "bx-app-h5",
      "src/views/page.vue",
      2,
      5,
    );

    assert.deepEqual(snippet.lines, [
      "<template>",
      "  <div>source</div>",
      "</template>",
      "",
    ]);
    assert.equal(catalog.status().ready, true);
    assert.equal(catalog.status().refreshFailed, true);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /reusing existing checkout/);

    await catalog.prepare();
    assert.equal(catalog.status().refreshFailed, true);

    time += 1_001;
    await catalog.prepare();
    assert.equal(catalog.status().refreshFailed, false);
    assert.equal(messages.length, 1);
  });
});

test("git catalog refuses another repository and credential-bearing URLs", async () => {
  await withFixture(async ({ root, fixture }) => {
    const worktree = join(root, "checkout");
    await cp(fixture, worktree, { recursive: true });
    const catalog = new GitH5SourceCatalog({
      repoUrl: repositoryUrl,
      worktree,
      username: "ci-reader",
      password: "secret-token",
      runGit: async () => ({ stdout: "https://other.example/repo.git\n" }),
    });
    await assert.rejects(catalog.prepare(), GitSourceUnavailableError);

    assert.throws(
      () =>
        new GitH5SourceCatalog({
          repoUrl: "https://user:password@gitlab.example/repo.git",
          worktree: join(root, "unsafe"),
        }),
      /must not contain credentials/,
    );
  });
});

test("git catalog validates branch and apps paths without starting Git", async () => {
  const worktree = "/tmp/umeng-sink-invalid-checkout";
  assert.throws(
    () =>
      new GitH5SourceCatalog({
        repoUrl: repositoryUrl,
        branch: "-upload-pack",
        worktree,
      }),
    /unsafe Git ref/,
  );
  assert.throws(
    () =>
      new GitH5SourceCatalog({
        repoUrl: repositoryUrl,
        worktree,
        appsDir: "../outside",
      }),
    /unsafe path/,
  );
});

test("git catalog supports server-side deploy keys without HTTP credentials", async () => {
  const catalog = new GitH5SourceCatalog({
    repoUrl: repositoryUrl,
    worktree: "/tmp/umeng-sink-deploy-key-checkout",
  });
  assert.equal(catalog.username, null);
  assert.equal(catalog.password, null);
  assert.throws(
    () =>
      new GitH5SourceCatalog({
        repoUrl: repositoryUrl,
        worktree: "/tmp/umeng-sink-partial-credentials",
        username: "ci-reader",
      }),
    /set together/,
  );
});
