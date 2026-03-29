import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempDir } from "../helpers/fs.ts";
import { cleanupDir } from "../helpers/fs.ts";

describe("git services", () => {
  it("normalizes URLs and extracts project names", async () => {
    const git = await import("../../src/services/git.ts");

    expect(git.normalizeGitUrl("git@github.com:acme/repo.git")).toBe(
      "git@github.com:acme/repo.git",
    );
    expect(git.normalizeGitUrl("https://github.com/acme/repo.git")).toBe(
      "https://github.com/acme/repo",
    );
    expect(git.projectNameFromUrl("git@github.com:acme/repo.git")).toBe(
      "acme/repo",
    );
    expect(git.projectNameFromUrl("https://github.com/acme/repo.git")).toBe(
      "acme/repo",
    );
    expect(git.projectNameFromUrl("not-a-url.git")).toBe("not-a-url");
  });

  it("returns the origin remote for a git repository", async () => {
    const repoDir = createTempDir("git-origin");

    try {
      execSync("git init", { cwd: repoDir, stdio: "pipe" });
      execSync("git remote add origin git@github.com:acme/repo.git", {
        cwd: repoDir,
        stdio: "pipe",
      });

      const git = await import("../../src/services/git.ts");
      expect(git.getGitOrigin(repoDir)).toBe("git@github.com:acme/repo.git");
    } finally {
      cleanupDir(repoDir);
    }
  });
});
