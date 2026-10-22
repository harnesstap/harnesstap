import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPluginByName } from "../../src/models/plugin-model.ts";
import { syncPluginPinsForApply } from "../../src/services/plugin-pin-apply.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

// A git dependency written with `"constraint": ""` is unpinned, the same as
// `*`: doctor warns that it tracks HEAD, and apply installs it instead of
// failing later with "No local version of ... is installed".
let root: string;
let remoteUrl: string;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ht-git-dep-empty-"));
  const work = join(root, "work");
  mkdirSync(join(work, ".claude-plugin"), { recursive: true });
  mkdirSync(join(work, "skills", "greet"), { recursive: true });
  git(work, "init", "--quiet");
  writeFileSync(
    join(work, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "gitdep", version: "0.1.0", description: "git dep" }),
  );
  writeFileSync(join(work, "skills", "greet", "SKILL.md"), "---\nname: greet\ndescription: greet\n---\n# hi\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "one");
  git(root, "clone", "--quiet", "--bare", work, join(root, "gitdep.git"));
  remoteUrl = `file://${join(root, "gitdep.git")}`;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("git-dep-empty-");
});
afterEach(async () => {
  await ctx.cleanup();
});

describe("git dependency with an empty constraint", () => {
  for (const constraint of ["", "*"]) {
    it(`installs the default branch HEAD for constraint ${JSON.stringify(constraint)}`, async () => {
      const result = await syncPluginPinsForApply({
        pins: [{ ref: remoteUrl, version_constraint: constraint }],
        homeRoot: ctx.homeDir,
        projectRoot: ctx.homeDir,
        yes: true,
      });
      expect(result.installs.map((install) => install.status)).toEqual(["installed"]);
      expect(getPluginByName("gitdep")).toBeDefined();
    });
  }
});
