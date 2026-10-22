import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import {
  catalogPluginDisplayVersion,
  catalogPluginVersionLabel,
} from "../../src/services/marketplace-catalog-parse.ts";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
}

function writePlugin(root: string, name: string, version: string): void {
  const pluginRoot = join(root, "plugins", name);
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(pluginRoot, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name, version, description: `${name} plugin` })}\n`,
  );
}

describe("catalogPluginDisplayVersion", () => {
  it("prefers the marketplace version, then plugin.json, and never a sha", () => {
    expect(catalogPluginDisplayVersion({ version: "1.0.0", manifestVersion: "2.0.0" })).toBe(
      "1.0.0",
    );
    expect(catalogPluginDisplayVersion({ manifestVersion: "2.0.0" })).toBe("2.0.0");
    expect(catalogPluginDisplayVersion({ version: SHA.slice(0, 12), manifestVersion: "2.0.0" })).toBe(
      "2.0.0",
    );
    expect(catalogPluginDisplayVersion({ version: SHA.slice(0, 12) })).toBeUndefined();
    expect(catalogPluginVersionLabel({ version: SHA.slice(0, 12) })).toBeUndefined();
    expect(catalogPluginVersionLabel({ manifestVersion: "2.0.0" })).toBe("v2.0.0");
  });
});

describe("marketplace show VERSION column", () => {
  it("shows the plugin.json version and no commit sha", async () => {
    const context = await createTestContext("cli-mkt-show-version");
    const repo = mkdtempSync(join(tmpdir(), "mkt-show-version-"));
    try {
      await runCli(["init"]);
      writePlugin(repo, "listed", "9.9.9");
      writePlugin(repo, "plain", "2.3.0");
      mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(repo, ".claude-plugin", "marketplace.json"),
        `${JSON.stringify({
          name: "vers",
          owner: { name: "t" },
          plugins: [
            { name: "listed", source: "./plugins/listed", version: "1.0.0" },
            { name: "plain", source: "./plugins/plain" },
            { name: "pinned", source: { source: "github", repo: "o/pinned", sha: SHA } },
          ],
        })}\n`,
      );
      git(repo, ["init"]);
      git(repo, ["add", "."]);
      git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);

      const add = await runCli(["marketplace", "add", repo, "--name", "vers"], {
        isTTY: false,
      });
      expect(add.exitCode ?? 0).toBe(0);

      const json = await runCli(
        ["marketplace", "show", "vers", "--no-interactive", "--format", "json"],
        { isTTY: false },
      );
      expect(json.exitCode ?? 0).toBe(0);
      const shown = JSON.parse(json.stdout) as {
        plugins: Array<{ name: string; version?: string; manifestVersion?: string }>;
      };
      const byName = new Map(shown.plugins.map((plugin) => [plugin.name, plugin]));
      expect(byName.get("plain")?.manifestVersion).toBe("2.3.0");
      expect(byName.get("listed")?.version).toBe("1.0.0");

      const table = await runCli(["marketplace", "show", "vers", "--no-interactive"], {
        isTTY: false,
      });
      expect(table.exitCode ?? 0).toBe(0);
      const line = (name: string) =>
        table.stdout.split("\n").find((row) => row.replace(/^[|\s]+/, "").startsWith(`${name} `)) ?? "";
      expect(line("plain")).toContain("2.3.0");
      expect(line("listed")).toContain("1.0.0");
      expect(line("listed")).not.toContain("9.9.9");
      expect(line("pinned")).not.toBe("");
      expect(line("pinned")).not.toContain(SHA.slice(0, 7));
    } finally {
      rmSync(repo, { recursive: true, force: true });
      await context.cleanup();
    }
  });
});
