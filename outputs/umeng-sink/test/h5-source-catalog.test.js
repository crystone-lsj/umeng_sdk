import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { H5SourceCatalog } from "../src/h5-source-catalog.js";

async function withFixture(run) {
  const root = await mkdtemp(join(tmpdir(), "umeng-h5-catalog-"));
  try {
    const app = join(root, "bx-app-h5");
    await mkdir(join(app, "src/views"), { recursive: true });
    await mkdir(join(app, "packages/shared"), { recursive: true });
    await mkdir(join(app, "dist"), { recursive: true });
    await writeFile(
      join(app, "src/views/page.vue"),
      "<template>\n  <div>first</div>\n  <div>second</div>\n</template>\n",
    );
    await writeFile(
      join(app, "packages/shared/index.js"),
      "export const value = 1;\n",
    );
    await writeFile(join(app, "dist/generated.js"), "generated\n");
    await writeFile(join(app, "root.js"), "root\n");
    return await run({ root, app });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("catalog discovers every direct app directory and preserves explicit aliases", async () => {
  await withFixture(async ({ root }) => {
    const catalog = new H5SourceCatalog({ appsRoot: root });
    assert.equal(catalog.resolveApp("bx-app-h5").name, "bx-app-h5");
    await mkdir(join(root, "other-app", "src"), { recursive: true });
    const discovered = new H5SourceCatalog({ appsRoot: root });
    assert.equal(discovered.resolveApp("other-app").target, "other-app");
    assert.deepEqual(catalog.status(), {
      configured: true,
      defaultApp: "bx-app-h5",
      apps: ["bx-app-h5"],
    });

    const mapped = new H5SourceCatalog({
      appsRoot: root,
      appMap: { client: "bx-app-h5" },
    });
    assert.equal(
      mapped.resolveApp("client").directory,
      join(root, "bx-app-h5"),
    );
    assert.equal(
      mapped.resolveApp("bx-app-h5").directory,
      join(root, "bx-app-h5"),
    );
  });
});

test("catalog reads source snippets and scans only src/packages", async () => {
  await withFixture(async ({ root }) => {
    const catalog = new H5SourceCatalog({ appsRoot: root });
    const snippet = await catalog.readSnippet(
      "bx-app-h5",
      "http://192.168.1.7:5173/src/views/page.vue",
      2,
      5,
    );
    assert.equal(snippet.file, "src/views/page.vue");
    assert.equal(snippet.line, 2);
    assert.deepEqual(snippet.lines, [
      "<template>",
      "  <div>first</div>",
      "  <div>second</div>",
      "</template>",
      "",
    ]);

    const files = await catalog.listFiles("bx-app-h5");
    assert.deepEqual(files.map((entry) => entry.file).sort(), [
      "packages/shared/index.js",
      "src/views/page.vue",
    ]);
  });
});

test("catalog rejects symlink escapes when reading and scanning", async () => {
  await withFixture(async ({ root, app }) => {
    const outside = await mkdtemp(join(tmpdir(), "umeng-h5-outside-"));
    try {
      const outsideFile = join(outside, "secret.js");
      await writeFile(outsideFile, "secret\n");
      await symlink(outsideFile, join(app, "src", "secret.js"));
      await symlink(outside, join(app, "packages", "outside"));

      const catalog = new H5SourceCatalog({ appsRoot: root });
      assert.equal(
        await catalog.readSnippet("bx-app-h5", "src/secret.js", 1, 1),
        null,
      );
      assert.deepEqual(
        (await catalog.listFiles("bx-app-h5"))
          .map((entry) => entry.file)
          .sort(),
        ["packages/shared/index.js", "src/views/page.vue"],
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
