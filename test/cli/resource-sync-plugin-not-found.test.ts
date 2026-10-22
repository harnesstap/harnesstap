import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd: repo,
    stdio: "ignore",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

describe("resource sync of a plugin the marketplace does not list", () => {
  it("exits 1 with plugin not found in marketplace, not Checked 0 resources", async () => {
    const context = await createTestContext("cli-sync-not-found");
    const repo = mkdtempSync(join(tmpdir(), "sync-not-found-mkt-"));
    try {
      await runCli(["init", "--no-interactive"]);
      mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
      mkdirSync(join(repo, "plugins", "dup", ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(repo, ".claude-plugin", "marketplace.json"),
        JSON.stringify({ name: "mkta", owner: { name: "t" }, plugins: [{ name: "dup", source: "./plugins/dup" }] }),
      );
      writeFileSync(
        join(repo, "plugins", "dup", ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "dup", version: "1.0.0" }),
      );
      git(repo, ["init"]);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", "init"]);
      const add = await runCli(["marketplace", "add", repo, "--name", "mkta"], { isTTY: false });
      expect(add.exitCode ?? 0).toBe(0);

      const result = await runCli(["resource", "sync", "plugin:nope@mkta"], { isTTY: false });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Could not install nope@mkta: Plugin nope not found in marketplace mkta.");
      expect(result.stdout).not.toContain("Checked 0 resources");
      expect(result.stderr).not.toContain("names no git source");
    } finally {
      rmSync(repo, { recursive: true, force: true });
      await context.cleanup();
    }
  });
});
