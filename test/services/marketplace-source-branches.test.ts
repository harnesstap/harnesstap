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
import { resetGithubTokenLookups } from "../../src/services/github-credentials.ts";

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

  it("passes a GitHub extraheader and keeps the token out of the URL", () => {
    const previous = {
      HARNESSTAP_GITHUB_TOKEN: process.env.HARNESSTAP_GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    };
    process.env.HARNESSTAP_GITHUB_TOKEN = "ghu_detect";
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    resetGithubTokenLookups();
    try {
      const seen: string[][] = [];
      const run: RunCommand = (_command, args) => {
        seen.push(args);
        return {
          stdout: "ref: refs/heads/main\tHEAD\nabc\trefs/heads/main\n",
          stderr: "",
          exitCode: 0,
        };
      };
      expect(
        listMarketplaceSourceBranches("git@github.com:acme/private.git", run),
      ).toEqual({
        branches: ["main"],
        defaultBranch: "main",
      });
      const args = seen[0] ?? [];
      const extra = args.find((arg) => arg.includes("AUTHORIZATION: basic "));
      expect(extra).toBeDefined();
      const encoded = extra?.split("AUTHORIZATION: basic ")[1] ?? "";
      expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("x-access-token:ghu_detect");
      expect(args.join(" ")).not.toContain("AUTHORIZATION: bearer");
      expect(args).toContain("https://github.com/acme/private.git");
      expect(args.join(" ")).not.toContain("ghu_detect@");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetGithubTokenLookups();
    }
  });
});
