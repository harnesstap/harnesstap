import { execSync } from "node:child_process";

export function initGitRepo(
  projectDir: string,
  origin = "git@github.com:acme/harnesstap-fixture.git",
): void {
  execSync("git init", { cwd: projectDir, stdio: "pipe" });
  execSync(`git remote add origin ${origin}`, {
    cwd: projectDir,
    stdio: "pipe",
  });
}
