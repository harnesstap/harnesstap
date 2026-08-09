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
  spawnSync("git", ["init"], { cwd: repo });
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

  it("adds a plugin pin to a layer without installing when profile is inactive", async () => {
    const context = await createTestContext("cli-plugin-add");
    try {
      await runCli(["init"]);
      await setupLocalMarketplace();
      await runCli(["layer", "create", "pins-layer"]);

      const add = await runCli(
        [
          "plugin",
          "add",
          "alpha@local-market",
          "--layer",
          "pins-layer",
          "--format",
          "json",
        ],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);
      const added = JSON.parse(add.stdout) as {
        status: string;
        ref: string;
        layerName: string;
        install?: unknown;
      };
      expect(added.status).toBe("attached");
      expect(added.ref).toBe("alpha@local-market");
      expect(added.layerName).toBe("pins-layer");
      expect(added.install).toBeUndefined();

      const show = await runCli(
        ["layer", "show", "pins-layer", "--format", "json"],
        { isTTY: false },
      );
      const layer = JSON.parse(show.stdout.trim()) as {
        plugin_pins: Array<{ ref: string }>;
      };
      expect(layer.plugin_pins).toHaveLength(1);
      expect(layer.plugin_pins[0]?.ref).toBe("alpha@local-market");
    } finally {
      await context.cleanup();
    }
  });

  it("requires --layer for plugin add in non-interactive mode", async () => {
    const context = await createTestContext("cli-plugin-add-missing-layer");
    try {
      await runCli(["init"]);
      await setupLocalMarketplace();
      await runCli(["layer", "create", "pins-layer"]);

      const add = await runCli(
        ["plugin", "add", "alpha@local-market", "--format", "json"],
        { isTTY: false },
      );

      expect(add.exitCode).toBe(2);
      expect(add.stderr).toContain("Layer is required");
      expect(add.stderr).toContain("USAGE");
    } finally {
      await context.cleanup();
    }
  });
});
