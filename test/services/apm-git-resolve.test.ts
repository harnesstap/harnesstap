import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { cleanupDir, createTempDir } from "../helpers/fs.ts";
import {
  classifyApmGitRef,
  canonicalApmRepoUrl,
  resolveApmGitDependency,
  resolveAndFetchApmGitDependency,
  selectSemverTag,
  ApmGitResolveError,
} from "../../src/services/apm-git-resolve.ts";
import { parseApmDependencyEntry } from "../../src/services/apm-dependencies.ts";
import type { Lockfile } from "../../src/services/lockfile.ts";
import type { RunCommand } from "../../src/plugins/run-command.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("apm-git-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function git(cwd: string, args: string): string {
  return execSync(`git -c user.email=test@example.com -c user.name=Test ${args}`, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writePluginTree(root: string, skill = "FROM-GIT"): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "ship"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "ship-kit", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "skills", "ship", "SKILL.md"),
    `---\nname: ship\ndescription: Ship\n---\n# ${skill}\n`,
  );
}

function createPluginGitRepo(skill = "FROM-GIT"): { dir: string; url: string; sha: string } {
  const dir = createTempDir("apm-git-remote-");
  writePluginTree(dir, skill);
  git(dir, "init");
  git(dir, "add -A");
  git(dir, "commit -m init");
  git(dir, "tag v1.0.0");
  git(dir, "tag v1.1.0");
  git(dir, "tag v2.0.0");
  const sha = git(dir, "rev-parse HEAD");
  return { dir, url: `file://${dir}`, sha };
}

describe("apm git resolve", () => {
  it("classifies refs per OpenAPM kinds", () => {
    expect(classifyApmGitRef(undefined)).toBe("none");
    expect(classifyApmGitRef("v1.2.3")).toBe("literal");
    expect(classifyApmGitRef("1.2.3")).toBe("literal");
    expect(classifyApmGitRef("a".repeat(40))).toBe("literal");
    expect(classifyApmGitRef("main")).toBe("literal");
    expect(classifyApmGitRef("^1.2.0")).toBe("semver");
    expect(classifyApmGitRef("~2.0")).toBe("semver");
    expect(classifyApmGitRef(">=1.0.0 <2.0.0")).toBe("semver");
  });

  it("canonicalizes repo URLs", () => {
    expect(canonicalApmRepoUrl("https://github.com/acme/widgets.git")).toBe(
      "github.com/acme/widgets",
    );
    expect(canonicalApmRepoUrl("git@github.com:acme/widgets.git")).toBe(
      "github.com/acme/widgets",
    );
    expect(canonicalApmRepoUrl("ssh://git@github.com/acme/widgets.git")).toBe(
      "github.com/acme/widgets",
    );
  });

  it("selects the highest matching semver tag", () => {
    const selected = selectSemverTag("^1.0.0", ["v1.0.0", "v1.1.0", "v2.0.0", "not-a-tag"]);
    expect(selected?.tag).toBe("v1.1.0");
    expect(selectSemverTag("^3.0.0", ["v1.0.0"])).toBeUndefined();
  });

  it("resolves a tag to a commit SHA and fetches it", () => {
    const remote = createPluginGitRepo();
    try {
      const dependency = parseApmDependencyEntry({
        git: remote.url,
        ref: "v1.0.0",
      });
      const fetched = resolveAndFetchApmGitDependency(dependency, ctx.homeDir);
      expect(fetched.commit).toBe(remote.sha);
      expect(fetched.replayed).toBe(false);
      expect(fetched.resolvedRef).toBe("v1.0.0");
    } finally {
      cleanupDir(remote.dir);
    }
  });

  it("fails closed when the ref cannot be resolved", () => {
    const remote = createPluginGitRepo();
    try {
      const dependency = parseApmDependencyEntry({
        git: remote.url,
        ref: "does-not-exist",
      });
      expect(() => resolveApmGitDependency(dependency)).toThrow(ApmGitResolveError);
    } finally {
      cleanupDir(remote.dir);
    }
  });

  it("replays a locked commit without ls-remote", () => {
    const remote = createPluginGitRepo();
    const calls: string[] = [];
    const runCommand: RunCommand = (command, args) => {
      calls.push([command, ...args].join(" "));
      throw new Error("network should not run");
    };
    try {
      const dependency = parseApmDependencyEntry({
        git: remote.url,
        ref: "main",
      });
      const lock: Lockfile = {
        root: "demo",
        resolved_at: new Date().toISOString(),
        resource_map_hash: "sha256:00",
        plugins: [
          {
            name: "widgets",
            version: "1.0.0",
            source: "git",
            integrity: "sha256:00",
            depth: 1,
            path: [],
            repo_url: canonicalApmRepoUrl(remote.url),
            resolved_commit: remote.sha,
            resolved_ref: "main",
          },
        ],
      };
      const resolved = resolveApmGitDependency(dependency, { lock, runCommand });
      expect(resolved.commit).toBe(remote.sha);
      expect(resolved.replayed).toBe(true);
      expect(calls).toEqual([]);
    } finally {
      cleanupDir(remote.dir);
    }
  });

  it("rejects a traversing virtual path", () => {
    const remote = createPluginGitRepo();
    try {
      const dependency = parseApmDependencyEntry({
        git: remote.url,
        path: "skills/../../etc",
      });
      expect(() => resolveApmGitDependency(dependency)).toThrow(/Unsafe dependencies.apm path/);
    } finally {
      cleanupDir(remote.dir);
    }
  });

  it("rejects a symlink in the package tree", async () => {
    const remote = createPluginGitRepo();
    try {
      symlinkSync("/tmp", join(remote.dir, "leak"));
      git(remote.dir, "add -A");
      git(remote.dir, "commit -m leak");
      const sha = git(remote.dir, "rev-parse HEAD");
      const dependency = parseApmDependencyEntry({ git: remote.url, ref: sha });
      const fetched = resolveAndFetchApmGitDependency(dependency, ctx.homeDir);
      const { importApmGitCheckout } = await import("../../src/services/apm-git-import.ts");
      await expect(importApmGitCheckout(fetched, fetched.checkoutRoot)).rejects.toThrow(/symlink/i);
    } finally {
      cleanupDir(remote.dir);
    }
  });
});
