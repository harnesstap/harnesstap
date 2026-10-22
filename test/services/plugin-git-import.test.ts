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
import { listDependencies } from "../../src/services/plugin-dependency.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("git-import-");
});
afterEach(async () => {
  await ctx.cleanup();
});

const ponytailLayoutFixture = join(
  import.meta.dirname,
  "../fixtures/plugin-import/git-origin-ponytail",
);

function writePluginJsonRoot(root: string, name: string): void {
  mkdirSync(join(root, "skills", "mane"), { recursive: true });
  writeFileSync(
    join(root, "plugin.json"),
    JSON.stringify({ name, version: "0.1.0", description: "Ponytail helpers" }),
  );
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
  expect(stored?.version).toBe("0.1.0");
  expect(stored?.description).toBe("Ponytail helpers");
  expect(stored?.origin).toBe("upstream");
  expect(stored?.origin_locator).toBe("https://github.com/DietrichGebert/ponytail.git");
  expect(stored?.origin_fingerprint).toBe("abc123def456");
  expect(getPluginResources(imported.plugin.id).some((r) => r.name === "mane")).toBe(true);
});

it("imports one git-origin plugin when skills/<name> is not an AP package", async () => {
  const imported = await importPluginFromGitHubRef("DietrichGebert/ponytail", {
    refreshGit: refreshFrom(ponytailLayoutFixture),
  });
  expect(imported.plugin.name).toBe("ponytail");
  expect(imported.created).toBe(true);
  expect(imported.origin_locator).toBe("https://github.com/DietrichGebert/ponytail.git");
  const resources = getPluginResources(imported.plugin.id);
  expect(resources.filter((r) => r.type === "skill").map((r) => r.name)).toEqual(["ponytail"]);
  expect(resources.some((r) => r.type === "plugin" && r.origin_ref === "ponytail@local")).toBe(true);
  expect(listDependencies(imported.plugin.id).some((dep) => dep.ref === "ponytail@local")).toBe(false);
  expect(getPluginByName("ponytail")?.origin).toBe("upstream");
  expect(getPluginByName("ponytail")?.version).toBe("0.0.0+git.abc123def456");
  expect(getPluginByName("ponytail")?.description).toBe("Session helpers from ponytail");
});

it("uses .claude-plugin/plugin.json version and description when root plugin.json is a stub", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-ponytail-overlay-"));
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "ponytail"), { recursive: true });
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name: "ponytail" }));
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "ponytail",
      version: "5.1.0",
      description: "Session helpers from the Claude overlay",
    }),
  );
  writeFileSync(
    join(root, "skills", "ponytail", "SKILL.md"),
    "---\nname: ponytail\n---\n# ponytail\n",
  );

  const imported = await importPluginFromGitHubRef("DietrichGebert/ponytail", {
    refreshGit: refreshFrom(root),
  });
  expect(imported.plugin.version).toBe("5.1.0");
  expect(imported.plugin.description).toBe("Session helpers from the Claude overlay");
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

function pinnedRefreshFrom(root: string, seen: Array<string | undefined>, sha: string) {
  return async (opts: { url: string; targetDir: string; ref?: string }) => {
    seen.push(opts.ref);
    mkdirSync(opts.targetDir, { recursive: true });
    cpSync(root, opts.targetDir, { recursive: true });
    return { ok: true as const, sha, message: "ok" };
  };
}

it("fetches a pinned commit, tag or branch and keeps the pin on the origin (#500)", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-ponytail-pin-"));
  writePluginJsonRoot(root, "ponytail");
  const seen: Array<string | undefined> = [];

  const imported = await importPluginFromGitHubRef("git@github.com:DietrichGebert/ponytail.git#F8797FE", {
    refreshGit: pinnedRefreshFrom(root, seen, "f8797fe0123456789abcdef0123456789abcdef0"),
  });
  expect(seen).toEqual(["f8797fe"]);
  expect(imported.origin_locator).toBe("https://github.com/DietrichGebert/ponytail.git#f8797fe");
  expect(getPluginByName("ponytail")?.origin_locator).toBe(
    "https://github.com/DietrichGebert/ponytail.git#f8797fe",
  );
  expect(getPluginByName("ponytail")?.origin_fingerprint).toBe("f8797fe0123456789abcdef0123456789abcdef0");

  // Re-pinning the same repository to a branch updates the same plugin.
  const repinned = await importPluginFromGitHubRef(
    "DietrichGebert/ponytail",
    { refreshGit: pinnedRefreshFrom(root, seen, "1111111111111111111111111111111111111111") },
    { ref: "ref:main" },
  );
  expect(repinned.created).toBe(false);
  expect(seen).toEqual(["f8797fe", "main"]);
  expect(getPluginByName("ponytail")?.origin_locator).toBe(
    "https://github.com/DietrichGebert/ponytail.git#main",
  );
});

it("resolves a semver pin to the highest matching tag (#500)", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-ponytail-semver-"));
  writePluginJsonRoot(root, "ponytail");
  const seen: Array<string | undefined> = [];
  const ranges: string[] = [];

  const imported = await importPluginFromGitHubRef(
    "DietrichGebert/ponytail",
    {
      refreshGit: pinnedRefreshFrom(root, seen, "2222222222222222222222222222222222222222"),
      resolveSemverTag: async (_url, range) => {
        ranges.push(range);
        return "v1.4.2";
      },
    },
    { ref: "^1.2.0" },
  );
  expect(ranges).toEqual(["^1.2.0"]);
  expect(seen).toEqual(["v1.4.2"]);
  expect(imported.origin_locator).toBe("https://github.com/DietrichGebert/ponytail.git#^1.2.0");
});

it("refuses a pin git cannot use before fetching (#500)", async () => {
  const seen: Array<string | undefined> = [];
  const attempt = importPluginFromGitHubRef(
    "DietrichGebert/ponytail#bad..ref",
    { refreshGit: pinnedRefreshFrom(ctx.homeDir, seen, "abc") },
  );
  await expect(attempt).rejects.toBeInstanceOf(GitPluginImportError);
  await expect(attempt).rejects.toThrow("Invalid git dependency constraint");
  expect(seen).toEqual([]);
  expect(getPluginByName("ponytail")).toBeUndefined();
});

it("records a freshly fetched git plugin as clean, not edited", async () => {
  const root = mkdtempSync(join(tmpdir(), "ht-ponytail-clean-"));
  writePluginJsonRoot(root, "ponytail");

  const imported = await importPluginFromGitHubRef("DietrichGebert/ponytail", {
    refreshGit: refreshFrom(root),
  });
  expect(getPluginById(imported.plugin.id)?.dirty).toBe(false);

  // Fetching it again (apply, update) keeps it clean.
  await importPluginFromGitHubRef("DietrichGebert/ponytail", {
    refreshGit: refreshFrom(root),
  });
  expect(getPluginById(imported.plugin.id)?.dirty).toBe(false);
});
