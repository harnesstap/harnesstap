import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshGitSource } from "../../src/plugins/refresh.ts";

// A local repository with two commits, a tag on the first and a branch on
// the second, served over file:// so no network is involved.
let root: string;
let remote: string;
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

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ht-pinned-ref-"));
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "--quiet");
  writeFileSync(join(work, "version.txt"), "one\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "one");
  git(work, "tag", "v0.1.0");
  first = git(work, "rev-parse", "HEAD");
  git(work, "checkout", "--quiet", "-b", "next");
  writeFileSync(join(work, "version.txt"), "two\n");
  git(work, "commit", "--quiet", "-am", "two");
  second = git(work, "rev-parse", "HEAD");
  git(work, "checkout", "--quiet", "main");
  remote = join(root, "remote.git");
  git(root, "clone", "--quiet", "--bare", work, remote);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function target(name: string): string {
  return join(root, "checkouts", name);
}

function content(dir: string): string {
  return readFileSync(join(dir, "version.txt"), "utf8").trim();
}

describe("refreshGitSource with a pinned ref (#500)", () => {
  it("tracks the default branch HEAD without a ref", async () => {
    const dir = target("head");
    const result = await refreshGitSource({ url: `file://${remote}`, targetDir: dir });
    expect(result.ok).toBe(true);
    expect(result.sha).toBe(first);
    expect(content(dir)).toBe("one");
  });

  it("checks out a full commit SHA", async () => {
    const dir = target("full");
    const result = await refreshGitSource({ url: `file://${remote}`, targetDir: dir, ref: second });
    expect(result.ok).toBe(true);
    expect(result.sha).toBe(second);
    expect(content(dir)).toBe("two");
  });

  it("checks out an abbreviated commit SHA", async () => {
    const dir = target("short");
    const result = await refreshGitSource({
      url: `file://${remote}`,
      targetDir: dir,
      ref: second.slice(0, 8),
    });
    expect(result.ok).toBe(true);
    expect(result.sha).toBe(second);
    expect(content(dir)).toBe("two");
  });

  it("checks out a branch and a tag", async () => {
    const branch = await refreshGitSource({ url: `file://${remote}`, targetDir: target("branch"), ref: "next" });
    expect(branch.sha).toBe(second);
    const tag = await refreshGitSource({ url: `file://${remote}`, targetDir: target("tag"), ref: "v0.1.0" });
    expect(tag.sha).toBe(first);
    expect(content(target("tag"))).toBe("one");
  });

  it("fails with the ref named when it does not exist and keeps the previous checkout", async () => {
    const dir = target("keep");
    await refreshGitSource({ url: `file://${remote}`, targetDir: dir, ref: "v0.1.0" });
    for (const ref of ["no-such-branch", "deadbeef00"]) {
      const result = await refreshGitSource({ url: `file://${remote}`, targetDir: dir, ref });
      expect(result.ok).toBe(false);
      expect(result.message).toContain(ref);
    }
    expect(content(dir)).toBe("one");
    expect(existsSync(`${dir}.incoming`)).toBe(false);
  });
});
