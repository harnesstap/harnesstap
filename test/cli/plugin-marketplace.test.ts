import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

function initLocalMarketplaceRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "ht-mkt-repo-"));
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "local-market",
      plugins: [
        { name: "alpha", version: "1.0.0" },
        { name: "beta", version: "2.0.0" },
      ],
    }),
  );
  const gitDir = `${repo}.git`;
  spawnSync("git", ["--git-dir", gitDir, "--work-tree", repo, "-c", "init.templateDir=", "init"], {
    cwd: repo,
  });
  writeFileSync(join(repo, ".git"), `gitdir: ${gitDir}\n`);
  spawnSync("git", ["add", "."], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: repo,
  });
  spawnSync("git", ["branch", "-M", "main"], { cwd: repo });
  return repo;
}

async function setupLocalMarketplace(): Promise<string> {
  const repo = initLocalMarketplaceRepo();
  await runCli(
    [
      "marketplace",
      "add",
      repo,
      "--name",
      "local-market",
      "--platform",
      "claude-code",
      "--format",
      "json",
    ],
    { isTTY: false },
  );
  return repo;
}

describe("CLI plugin marketplace", () => {
  it("searches configured marketplace catalogs", async () => {
    const context = await createTestContext("cli-plugin-search");
    try {
      await runCli(["init"]);
      await setupLocalMarketplace();

      const search = await runCli(["plugin", "search", "--format", "json"], {
        isTTY: false,
      });
      expect(search.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(search.stdout) as {
        plugins: Array<{ name: string; ref: string }>;
      };
      expect(payload.plugins.map((plugin) => plugin.name).sort()).toEqual([
        "alpha",
        "beta",
      ]);
      expect(payload.plugins.every((plugin) => plugin.ref.endsWith("@local-market"))).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("adds a dependency to a plugin with plugin add --to", async () => {
    const context = await createTestContext("cli-plugin-add");
    try {
      await runCli(["init"]);
      await setupLocalMarketplace();
      await runCli(["plugin", "create", "pins-plugin"]);

      const add = await runCli(
        [
          "plugin",
          "add",
          "alpha@local-market",
          "--to",
          "pins-plugin",
          "--format",
          "json",
        ],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);
      const added = JSON.parse(add.stdout) as {
        ref: string;
        to: string;
      };
      expect(added.ref).toBe("alpha@local-market");
      expect(added.to).toBe("pins-plugin");

      const show = await runCli(
        ["plugin", "show", "pins-plugin", "--format", "json"],
        { isTTY: false },
      );
      const plugin = JSON.parse(show.stdout.trim()) as {
        dependencies: Array<{ name: string }>;
      };
      expect(plugin.dependencies.map((d) => d.dependency_name)).toContain("alpha@local-market");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --to for plugin add in non-interactive mode", async () => {
    const context = await createTestContext("cli-plugin-add-missing-plugin");
    try {
      await runCli(["init"]);
      await setupLocalMarketplace();
      await runCli(["plugin", "create", "pins-plugin"]);

      const add = await runCli(
        ["plugin", "add", "alpha@local-market", "--format", "json"],
        { isTTY: false },
      );

      expect(add.exitCode).toBe(2);
      expect(add.stderr).toContain("Plugin is required");
      expect(add.stderr).toContain("Pass --to");
    } finally {
      await context.cleanup();
    }
  });
});
