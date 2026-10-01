import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import type { RunCommand } from "../../src/plugins/run-command.ts";
import {
  listMarketplaceSourceBranches,
  parseGitForEachRefHeads,
  parseGitHeadSymref,
  parseGitLsRemoteHeads,
} from "../../src/services/marketplace-source-branches.ts";

function initLocalRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-mkt-branches-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "local-market", plugins: [] }),
  );
  spawnSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: repo, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"],
    { cwd: repo, stdio: "ignore" },
  );
  spawnSync("git", ["branch", "-M", "main"], { cwd: repo, stdio: "ignore" });
  spawnSync("git", ["branch", "develop"], { cwd: repo, stdio: "ignore" });
  return repo;
}

describe("parse git branch listings", () => {
  it("parses ls-remote heads and the HEAD symref", () => {
    const stdout = [
      "ref: refs/heads/main\tHEAD",
      "abc\trefs/heads/main",
      "def\trefs/heads/develop",
      "abc\trefs/heads/main",
    ].join("\n");
    expect(parseGitHeadSymref(stdout)).toBe("main");
    expect(parseGitLsRemoteHeads(stdout)).toEqual(["main", "develop"]);
  });

  it("parses local for-each-ref names", () => {
    expect(parseGitForEachRefHeads("main\ndevelop\nmain\n")).toEqual([
      "main",
      "develop",
    ]);
  });
});

describe("listMarketplaceSourceBranches", () => {
  it("lists local heads and the current branch", () => {
    const repo = initLocalRepo();
    const listed = listMarketplaceSourceBranches(repo);
    expect(listed.defaultBranch).toBe("main");
    expect(listed.branches.sort()).toEqual(["develop", "main"]);
  });

  it("lists remote heads from ls-remote", () => {
    const run: RunCommand = (_command, args) => {
      if (args.includes("ls-remote")) {
        return {
          stdout: "ref: refs/heads/main\tHEAD\nabc\trefs/heads/main\ndef\trefs/heads/develop\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "", stderr: "unexpected", exitCode: 1 };
    };
    expect(listMarketplaceSourceBranches("https://github.com/org/repo.git", run)).toEqual({
      branches: ["main", "develop"],
      defaultBranch: "main",
    });
  });
});
