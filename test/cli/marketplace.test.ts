import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

function initLocalMarketplaceRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-cli-mkt-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "local-market", plugins: [{ name: "alpha", version: "1.0.0" }] }),
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

describe("CLI marketplace", () => {
  it("adds and lists a marketplace", async () => {
    const context = await createTestContext("cli-mkt-add-list");
    try {
      await runCli(["init"]);
      const repo = initLocalMarketplaceRepo();
      const add = await runCli(
        [
          "marketplace",
          "add",
          repo,
          "--name",
          "demo",
          "--platform",
          "claude-code",
          "--format",
          "json",
        ],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);
      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const payload = JSON.parse(list.stdout);
      expect(payload.marketplaces[0].name).toBe("demo");
    } finally {
      await context.cleanup();
    }
  });

  it("adds a local path marketplace with extra tracked branches", async () => {
    const context = await createTestContext("cli-mkt-local-branches");
    const repo = initLocalMarketplaceRepo();
    try {
      await runCli(["init"]);
      const add = await runCli(
        [
          "marketplace",
          "add",
          `file://${repo}`,
          "--name",
          "local-market",
          "--branch",
          "develop",
          "--format",
          "json",
        ],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(add.stdout);
      expect(payload.entry.url).toBe(repo);
      expect(payload.entry.trackedBranches).toEqual(["develop"]);
      expect(payload.refresh.ok).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("removes a configured marketplace", async () => {
    const context = await createTestContext("cli-mkt-remove");
    try {
      await runCli(["init"]);
      const repo = initLocalMarketplaceRepo();
      await runCli(
        [
          "marketplace",
          "add",
          repo,
          "--name",
          "demo",
          "--platform",
          "claude-code",
          "--format",
          "json",
        ],
        { isTTY: false },
      );

      const remove = await runCli(
        ["marketplace", "remove", "demo", "--format", "json"],
        { isTTY: false },
      );
      expect(remove.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(remove.stdout);
      expect(payload.status).toBe("removed");
      expect(payload.entry.name).toBe("demo");

      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const listed = JSON.parse(list.stdout);
      expect(listed.marketplaces).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects a bogus URL without saving", async () => {
    const context = await createTestContext("cli-mkt-bogus-url");
    try {
      await runCli(["init"]);
      const add = await runCli(
        [
          "marketplace",
          "add",
          "https://github.com/example/does-not-exist-ht.git",
          "--name",
          "bogus",
          "--no-interactive",
        ],
        { isTTY: false },
      );
      expect(add.exitCode).toBe(1);
      expect(`${add.stdout}\n${add.stderr}`).toContain("Couldn't reach");
      expect(`${add.stdout}\n${add.stderr}`).toContain("Nothing was saved.");
      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const payload = JSON.parse(list.stdout);
      expect(
        (payload.marketplaces as Array<{ name: string }>).some((row) => row.name === "bogus"),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects a local path that is not a marketplace", async () => {
    const context = await createTestContext("cli-mkt-empty-dir");
    const empty = mkdtempSync(join(tmpdir(), "ht-cli-mkt-empty-"));
    try {
      await runCli(["init"]);
      const add = await runCli(
        ["marketplace", "add", empty, "--name", "empty"],
        { isTTY: false },
      );
      expect(add.exitCode).toBe(1);
      expect(`${add.stdout}\n${add.stderr}`).toContain("is not a marketplace");
      expect(`${add.stdout}\n${add.stderr}`).toContain("Nothing was saved.");
      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const payload = JSON.parse(list.stdout);
      expect(
        (payload.marketplaces as Array<{ name: string }>).some((row) => row.name === "empty"),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("fails remove when marketplace is missing", async () => {
    const context = await createTestContext("cli-mkt-remove-missing");
    try {
      await runCli(["init"]);
      await expect(
        runCli(["marketplace", "remove", "missing"], { isTTY: false }),
      ).rejects.toThrow(/not found/i);
    } finally {
      await context.cleanup();
    }
  });
});
