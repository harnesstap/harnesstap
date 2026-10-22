import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

function initLocalMarketplace(root: string): string {
  const repo = join(root, "mkta");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins/dup/.claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins/dup/skills/dup-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({
      name: "mkta",
      owner: { name: "qa" },
      plugins: [{ name: "dup", source: "./plugins/dup", description: "dup" }],
    }),
  );
  writeFileSync(
    join(repo, "plugins/dup/.claude-plugin/plugin.json"),
    JSON.stringify({ name: "dup", version: "1.0.0" }),
  );
  writeFileSync(
    join(repo, "plugins/dup/skills/dup-skill/SKILL.md"),
    "---\nname: dup-skill\ndescription: dup\n---\ndup\n",
  );
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], {
    cwd: repo,
  });
  return repo;
}

describe("profile status and the Desktop panel agree on plugin installs", () => {
  it("reports a profile plugin Claude no longer has as out of sync, and --check fails", async () => {
    const context = await createInitializedTestContext("cli-status-plugin-gaps");
    try {
      const repo = initLocalMarketplace(context.rootDir);
      addMarketplace(getHarnesstapDir(), { url: repo, name: "mkta", platforms: ["claude-code"] });
      const profile = createPlugin({ name: "two" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "dup@mkta");
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      const applied = await applyProfilePlugin("two", {
        harness: "claude-code",
        conflictPolicy: "replace",
        yes: true,
      });
      expect(applied.cancelled).toBe(false);
      setActiveProfileName("two");

      writeFileSync(
        join(context.homeDir, ".claude/plugins/installed_plugins.json"),
        `${JSON.stringify({ version: 2, plugins: {} }, null, 2)}\n`,
      );

      const json = await runCli(["profile", "status", "--format", "json"]);
      const payload = JSON.parse(json.stdout) as { panel: { reasons: string[] } };
      expect(payload.panel.reasons).toContain("missing_plugins");

      const human = await runCli(["profile", "status", "--check"]);
      const output = `${human.stdout}\n${human.stderr}`;
      expect(output).toContain("out of sync");
      expect(output).toContain("Plugin dup@mkta is not installed in Claude Code.");
      expect(human.exitCode).toBe(1);
    } finally {
      await context.cleanup();
    }
  });
});
