import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { getPluginByName } from "../../src/models/plugin-model.ts";
import { runCli } from "../helpers/cli.ts";
import { createTestContext } from "../helpers/db.ts";

function git(repo: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repo, stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
}

function writePlugin(root: string, relative: string, name: string): void {
  const pluginRoot = join(root, relative);
  mkdirSync(join(pluginRoot, "skills", "demo-skill"), { recursive: true });
  writeFileSync(
    join(pluginRoot, "plugin.json"),
    `${JSON.stringify({ name, version: "1.2.0", description: name }, null, 2)}\n`,
  );
  writeFileSync(
    join(pluginRoot, "skills", "demo-skill", "SKILL.md"),
    `---\nname: ${name}-skill\ndescription: ${name} skill\n---\n\nDo the demo.\n`,
  );
}

function commitRepo(repo: string): void {
  git(repo, ["init"]);
  git(repo, ["add", "."]);
  git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"]);
}

describe("marketplace manifests and local sync", () => {
  it("lists every manifest, labels flavors, and drops a path that leaves the repo", async () => {
    const context = await createTestContext("cli-mkt-dual");
    try {
      await runCli(["init"]);
      const repo = mkdtempSync(join(tmpdir(), "ht-mkt-dual-"));
      writePlugin(repo, "plugins/copilot-one", "copilot-one");
      writePlugin(repo, "plugins/codex-one", "codex-one");
      mkdirSync(join(repo, ".github/plugin"), { recursive: true });
      mkdirSync(join(repo, ".agents/plugins"), { recursive: true });
      writeFileSync(
        join(repo, ".github/plugin/marketplace.json"),
        `${JSON.stringify({
          name: "dual",
          plugins: [{ name: "copilot-one", source: "plugins/copilot-one" }],
        })}\n`,
      );
      writeFileSync(
        join(repo, ".agents/plugins/marketplace.json"),
        `${JSON.stringify({
          name: "dual",
          plugins: [
            {
              name: "codex-one",
              source: { source: "local", path: "./plugins/codex-one" },
              version: "1.2.0",
            },
            { name: "outside", source: { source: "local", path: "../outside" } },
          ],
        })}\n`,
      );
      commitRepo(repo);

      const add = await runCli(
        ["marketplace", "add", repo, "--name", "dual", "--format", "json"],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);
      const added = JSON.parse(add.stdout) as {
        entry: { platforms: string[] };
        refresh: { warnings?: string[] };
      };
      expect(added.entry.platforms).toEqual(["copilot-cli"]);
      expect(added.refresh.warnings).toEqual([
        "Skipped outside: source path leaves the marketplace repository.",
      ]);

      const show = await runCli(
        ["marketplace", "show", "dual", "--no-interactive", "--format", "json"],
        { isTTY: false },
      );
      expect(show.exitCode ?? 0).toBe(0);
      const shown = JSON.parse(show.stdout) as {
        plugins: Array<{ name: string; flavor?: string }>;
      };
      expect(shown.plugins.map((plugin) => ({ name: plugin.name, flavor: plugin.flavor }))).toEqual([
        { name: "copilot-one", flavor: "copilot-cli" },
        { name: "codex-one", flavor: "codex" },
      ]);

      const list = await runCli(["marketplace", "list", "--format", "json"], {
        isTTY: false,
      });
      const listed = JSON.parse(list.stdout) as {
        marketplaces: Array<{ name: string; flavors: string[] }>;
      };
      const row = listed.marketplaces.find((entry) => entry.name === "dual");
      expect(row?.flavors).toEqual(["copilot-cli", "codex"]);

      const created = await runCli(["plugin", "create", "wrapper"], { isTTY: false });
      expect(created.exitCode ?? 0).toBe(0);
      const attached = await runCli(
        [
          "plugin",
          "edit",
          "wrapper",
          "--add",
          "plugin:codex-one@dual",
          "--type",
          "plugin",
          "--sync",
        ],
        { isTTY: false },
      );
      expect(attached.exitCode ?? 0).toBe(0);
      const again = await runCli(["resource", "sync", "plugin:codex-one@dual"], {
        isTTY: false,
      });
      expect(again.exitCode ?? 0).toBe(0);
      expect(again.stderr).not.toContain("Resource conflict");
      expect(getPluginByName("codex-one", "1.2.0")?.origin).toBe("upstream");
    } finally {
      await context.cleanup();
    }
  });

  it("syncs a Claude-format local marketplace pin and applies it", async () => {
    const context = await createTestContext("cli-mkt-claude-sync");
    try {
      await runCli(["init"]);
      const repo = mkdtempSync(join(tmpdir(), "ht-mkt-claude-"));
      writePlugin(repo, "plugins/demo", "demo");
      mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(repo, ".claude-plugin/marketplace.json"),
        `${JSON.stringify({
          name: "claude-local",
          plugins: [{ name: "demo", source: "plugins/demo", version: "1.2.0" }],
        })}\n`,
      );
      commitRepo(repo);

      const add = await runCli(
        ["marketplace", "add", repo, "--name", "claude-local", "--format", "json"],
        { isTTY: false },
      );
      expect(add.exitCode ?? 0).toBe(0);

      const created = await runCli(["plugin", "create", "wrapper"], { isTTY: false });
      expect(created.exitCode ?? 0).toBe(0);

      const attached = await runCli(
        [
          "plugin",
          "edit",
          "wrapper",
          "--add",
          "plugin:demo@claude-local",
          "--type",
          "plugin",
          "--sync",
        ],
        { isTTY: false },
      );
      expect(attached.exitCode ?? 0).toBe(0);
      expect(attached.stderr).not.toContain("Resource conflict");

      const again = await runCli(["resource", "sync", "plugin:demo@claude-local"], {
        isTTY: false,
      });
      expect(again.exitCode ?? 0).toBe(0);
      expect(again.stderr).not.toContain("Resource conflict");
      expect(getPluginByName("demo", "1.2.0")?.origin).toBe("upstream");

      const applied = await runCli(
        [
          "apply",
          "wrapper",
          "--project",
          context.projectDir,
          "--harness",
          "claude-code",
          "--no-interactive",
          "--yes",
        ],
        { isTTY: false },
      );
      expect(applied.stderr).not.toContain("No local version");
      expect(applied.exitCode ?? 0).toBe(0);
    } finally {
      await context.cleanup();
    }
  });
});
