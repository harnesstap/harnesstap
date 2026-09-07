import { afterEach, beforeEach, expect, it } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  getPluginById,
  getPluginByName,
  getPluginResources,
  createPlugin,
} from "../../src/models/plugin-model.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import {
  GitPluginImportError,
  MISSING_PLUGIN_JSON_MESSAGE,
  importPluginFromGitHubRef,
} from "../../src/services/plugin-git-import.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("git-import-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function writePluginJsonRoot(root: string, name: string): void {
  mkdirSync(join(root, "skills", "mane"), { recursive: true });
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name, version: "0.1.0" }));
  writeFileSync(
    join(root, "skills", "mane", "SKILL.md"),
    "---\nname: mane\ndescription: mane\n---\n# mane\n",
  );
}

function refreshFrom(root: string) {
  return async (opts: { url: string; targetDir: string }) => {
    mkdirSync(opts.targetDir, { recursive: true });
    cpSync(root, opts.targetDir, { recursive: true });
    return { ok: true as const, sha: "abc123def456", message: "ok" };
  };
}

it("imports a root plugin.json package as a git-origin plugin", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-ponytail-"));
  writePluginJsonRoot(root, "ponytail");

  const imported = await importPluginFromGitHubRef("DietrichGebert/ponytail", {
    refreshGit: refreshFrom(root),
  });
  expect(imported.plugin.name).toBe("ponytail");
  expect(imported.origin_locator).toBe("https://github.com/DietrichGebert/ponytail.git");
  expect(imported.origin_fingerprint).toBe("abc123def456");
  expect(imported.created).toBe(true);
  const stored = getPluginByName("ponytail");
  expect(stored?.origin).toBe("upstream");
  expect(stored?.origin_locator).toBe("https://github.com/DietrichGebert/ponytail.git");
  expect(stored?.origin_fingerprint).toBe("abc123def456");
  expect(getPluginResources(imported.plugin.id).some((r) => r.name === "mane")).toBe(true);
});

it("fails closed when the clone has no plugin.json", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-empty-"));
  writeFileSync(join(root, "README.md"), "# no plugin\n");

  try {
    await importPluginFromGitHubRef("acme/not-a-plugin", {
      refreshGit: refreshFrom(root),
    });
    throw new Error("expected import to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GitPluginImportError);
    expect((error as GitPluginImportError).code).toBe("missing_plugin_json");
    expect((error as GitPluginImportError).message).toBe(MISSING_PLUGIN_JSON_MESSAGE);
  }
  expect(getPluginByName("not-a-plugin")).toBeUndefined();
});

it("refuses to overwrite an authored plugin of the same name", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-conflict-"));
  writePluginJsonRoot(root, "ponytail");
  const authored = createPlugin({ name: "ponytail", origin: "authored" });
  setPluginOrigin(authored.id, "authored");

  try {
    await importPluginFromGitHubRef("DietrichGebert/ponytail", {
      refreshGit: refreshFrom(root),
    });
    throw new Error("expected import to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(GitPluginImportError);
    expect((error as GitPluginImportError).code).toBe("name_conflict");
  }
  expect(getPluginById(authored.id)?.origin).toBe("authored");
});
