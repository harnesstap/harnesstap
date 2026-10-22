import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "../../src/db/connection.ts";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { installPluginPinAsync } from "../../src/services/plugin-install.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-pin-apply.ts";
import { validatePluginPinsAgainstInventory } from "../../src/services/plugin-apply-validation.ts";
import { ensureMissingCatalogDependencies } from "../../src/services/plugin-catalog-install.ts";
import { gitOriginCacheDir } from "../../src/services/plugin-origin-apply.ts";
import { renderExplain } from "../../src/services/resolve/explain.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

// A git dependency pinned to a commit installs exactly that commit (#500).
let root: string;
let remoteUrl: string;
let first: string;
let second: string;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function writeSkill(work: string, body: string): void {
  mkdirSync(join(work, "skills", "greet"), { recursive: true });
  writeFileSync(join(work, "skills", "greet", "SKILL.md"), `---\nname: greet\ndescription: greet\n---\n# ${body}\n`);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ht-git-dep-pin-"));
  const work = join(root, "work");
  mkdirSync(join(work, ".claude-plugin"), { recursive: true });
  git(work, "init", "--quiet");
  writeFileSync(
    join(work, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "gitdep", version: "0.1.0", description: "git dep" }),
  );
  writeSkill(work, "one");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "one");
  first = git(work, "rev-parse", "HEAD");
  writeSkill(work, "two");
  git(work, "commit", "--quiet", "-am", "two");
  second = git(work, "rev-parse", "HEAD");
  git(root, "clone", "--quiet", "--bare", work, join(root, "gitdep.git"));
  remoteUrl = `file://${join(root, "gitdep.git")}`;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("git-dep-pin-");
});
afterEach(async () => {
  await ctx.cleanup();
});

describe("installing a pinned git dependency (#500)", () => {
  it("checks out the pinned commit, not the default branch HEAD", async () => {
    expect(second).not.toBe(first);
    const result = await installPluginPinAsync({
      ref: remoteUrl,
      scope: "user",
      homeRoot: ctx.homeDir,
      projectRoot: ctx.homeDir,
      versionConstraint: first.slice(0, 7),
    });
    expect(result.status).toBe("installed");

    const plugin = getPluginByName("gitdep");
    expect(plugin?.origin_locator).toBe(`${remoteUrl}#${first.slice(0, 7)}`);
    expect(plugin?.origin_fingerprint).toBe(first);
    const harnesstapDir = join(getDbPath(), "..");
    const skill = readFileSync(
      join(gitOriginCacheDir(harnesstapDir, remoteUrl), "skills", "greet", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("# one");
  });

  it("resolves a profile whose git dependency is pinned to a commit", async () => {
    await installPluginPinAsync({
      ref: remoteUrl,
      scope: "user",
      homeRoot: ctx.homeDir,
      projectRoot: ctx.homeDir,
      versionConstraint: first,
    });
    const profile = createPlugin({ name: "prof", version: "1.0.0" });
    addDependency(profile.id, remoteUrl, { versionConstraint: first });
    const resolution = resolveComposition({ rootSelectors: ["prof"] });
    expect(resolution.selected.map((selected) => selected.name)).toContain("gitdep");
  });

  it("explains a dependency pinned to a branch with the branch, not *", async () => {
    await installPluginPinAsync({
      ref: remoteUrl,
      scope: "user",
      homeRoot: ctx.homeDir,
      projectRoot: ctx.homeDir,
      versionConstraint: "main",
    });
    const profile = createPlugin({ name: "prof", version: "1.0.0" });
    addDependency(profile.id, remoteUrl, { versionConstraint: "main" });
    const resolution = resolveComposition({ rootSelectors: ["prof"] });
    const gitdep = resolution.selected.find((selected) => selected.name === "gitdep");
    expect(gitdep?.constraints.map((record) => record.declared)).toEqual(["main"]);
    const text = renderExplain(resolution);
    expect(text).toContain("prof@1.0.0 → gitdep main");
    expect(text).not.toContain("→ gitdep *");
  });

  it("fails with the missing ref named instead of falling back to HEAD", async () => {
    const result = await installPluginPinAsync({
      ref: remoteUrl,
      scope: "user",
      homeRoot: ctx.homeDir,
      projectRoot: ctx.homeDir,
      versionConstraint: "ref:no-such-tag",
    });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("no-such-tag");
    expect(getPluginByName("gitdep")).toBeUndefined();
  });

  // The fetch imports the plugin into the library, so apply must not then
  // report the dependency as not installed or without a resolved version.
  for (const pass of ["first", "second"]) {
    it(`reports a fetched branch dependency as resolved on the ${pass} apply`, async () => {
      const pins = [{ ref: remoteUrl, version_constraint: "main" }];
      const options = { pins, homeRoot: ctx.homeDir, projectRoot: ctx.homeDir, yes: true };
      if (pass === "second") await syncPluginPinsForApply(options);
      const result = await syncPluginPinsForApply(options);
      expect(result.installs.map((install) => install.version)).toEqual(["0.1.0"]);
      expect(result.unresolvedPins).toEqual([]);
      expect(validatePluginPinsAgainstInventory(pins)).toEqual([]);
    });
  }

  // A second project apply re-checks the library for every dependency. A
  // ref pin is not a semver range, so that check must not parse it as one.
  for (const constraint of ["main", "#main", "ref:main", "full-sha"]) {
    it(`re-checks an installed dependency pinned to ${constraint} without a semver error`, async () => {
      const pin = constraint === "full-sha" ? first : constraint;
      const installed = await installPluginPinAsync({
        ref: remoteUrl,
        scope: "user",
        homeRoot: ctx.homeDir,
        projectRoot: ctx.homeDir,
        versionConstraint: pin,
      });
      expect(installed.status).toBe("installed");
      const profile = createPlugin({ name: "prof", version: "1.0.0" });
      addDependency(profile.id, remoteUrl, { versionConstraint: pin });
      expect(await ensureMissingCatalogDependencies([profile.id])).toEqual([]);
    });
  }
});
