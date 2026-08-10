import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

/**
 * Initialize a git repo for tests.
 *
 * Uses a sibling `*.git` directory plus a `.git` gitdir pointer file so the
 * sandbox can create the store (writing into a literal `.git/` directory is
 * blocked in some environments).
 */
export function initGitRepo(
  projectDir: string,
  origin = "git@github.com:acme/harnesstap-fixture.git",
): void {
  const gitDir = `${projectDir}.git`;
  execSync(`git --git-dir=${JSON.stringify(gitDir)} --work-tree=${JSON.stringify(projectDir)} -c init.templateDir= init`, {
    stdio: "pipe",
  });
  writeFileSync(join(projectDir, ".git"), `gitdir: ${gitDir}\n`);
  execSync(`git remote add origin ${origin}`, {
    cwd: projectDir,
    stdio: "pipe",
  });
}
