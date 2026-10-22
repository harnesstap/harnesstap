import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { importPluginFromGitHubRef } from "../../src/services/plugin-git-import.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";
import { buildHarnessPluginRows } from "../../src/services/global-profile-status-panel.ts";
import { addMarketplace } from "../../src/services/marketplace-registry.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const ponytailLayoutFixture = join(
  import.meta.dirname,
  "../fixtures/plugin-import/git-origin-ponytail",
);

/** A local Claude-format marketplace (git repo) listing plugin `dup` with skill `dup-skill`. */
function initLocalClaudeMarketplace(root: string, name: string): string {
  const repo = join(root, name);
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins/dup/.claude-plugin"), { recursive: true });
  mkdirSync(join(repo, "plugins/dup/skills/dup-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({
      name,
      owner: { name: "qa" },
      plugins: [{ name: "dup", source: "./plugins/dup", description: `dup from ${name}` }],
    }),
  );
  writeFileSync(
    join(repo, "plugins/dup/.claude-plugin/plugin.json"),
    JSON.stringify({ name: "dup", version: "1.0.0" }),
  );
  writeFileSync(
    join(repo, "plugins/dup/skills/dup-skill/SKILL.md"),
    `---\nname: dup-skill\ndescription: dup from ${name}\n---\ndup from ${name}\n`,
  );
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], {
    cwd: repo,
  });
  return repo;
}

describe("claude host plugin apply", () => {
  it("registers a git plugin instead of writing its skills standalone", async () => {
    const context = await createInitializedTestContext("claude-host-plugin-apply");
    try {
      await importPluginFromGitHubRef("DietrichGebert/ponytail", {
        refreshGit: async (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(ponytailLayoutFixture, opts.targetDir, { recursive: true });
          return { ok: true, sha: "abc123def456", message: "ok" };
        },
      });

      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "ponytail");
      setHarnessPreference({ registered_harnesses: ["claude-code", "opencode"] });

      const applied = await applyProfilePlugin("work", {
        harness: "claude-code,opencode",
        conflictPolicy: "replace",
      });
      expect(applied.cancelled).toBe(false);

      const installedPath = join(context.homeDir, ".claude/plugins/installed_plugins.json");
      expect(existsSync(installedPath)).toBe(true);
      const installed = JSON.parse(readFileSync(installedPath, "utf-8")) as {
        plugins: Record<string, unknown>;
      };
      expect(installed.plugins["ponytail@local"]).toBeDefined();

      const settings = JSON.parse(
        readFileSync(join(context.homeDir, ".claude/settings.json"), "utf-8"),
      ) as { enabledPlugins?: Record<string, boolean> };
      expect(settings.enabledPlugins?.["ponytail@local"]).toBe(true);

      expect(existsSync(join(context.homeDir, ".claude/skills/ponytail/SKILL.md"))).toBe(false);
      expect(
        existsSync(join(context.homeDir, ".claude/plugins/cache/local/ponytail")),
      ).toBe(true);
      expect(
        existsSync(join(context.homeDir, ".config/opencode/skills/ponytail/SKILL.md"))
        || existsSync(join(context.homeDir, ".agents/skills/ponytail/SKILL.md")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("reports the registered git plugin as installed in status", async () => {
    const context = await createInitializedTestContext("claude-host-plugin-status");
    try {
      await importPluginFromGitHubRef("DietrichGebert/ponytail", {
        refreshGit: async (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(ponytailLayoutFixture, opts.targetDir, { recursive: true });
          return { ok: true, sha: "abc123def456", message: "ok" };
        },
      });
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "ponytail");
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      const applied = await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      expect(applied.cancelled).toBe(false);
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.harnesses["claude-code"]?.plugins).toEqual([
        { id: "ponytail", state: "installed" },
      ]);
      expect(status.panel.reasons).not.toContain("missing_plugins");
    } finally {
      await context.cleanup();
    }
  });

  it("registers a plugin from a local Claude-format marketplace and reports it installed", async () => {
    const context = await createInitializedTestContext("claude-host-plugin-local-mkt");
    try {
      const repo = initLocalClaudeMarketplace(context.rootDir, "mkta");
      addMarketplace(getHarnesstapDir(), { url: repo, name: "mkta", platforms: ["claude-code"] });
      const profile = createPlugin({ name: "two" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "dup@mkta");
      setHarnessPreference({ registered_harnesses: ["claude-code", "codex"] });

      const applied = await applyProfilePlugin("two", {
        harness: "claude-code,codex",
        conflictPolicy: "replace",
        yes: true,
      });
      expect(applied.cancelled).toBe(false);

      const installed = JSON.parse(
        readFileSync(join(context.homeDir, ".claude/plugins/installed_plugins.json"), "utf-8"),
      ) as { plugins: Record<string, unknown> };
      expect(installed.plugins["dup@mkta"]).toBeDefined();
      const settings = JSON.parse(
        readFileSync(join(context.homeDir, ".claude/settings.json"), "utf-8"),
      ) as { enabledPlugins?: Record<string, boolean> };
      expect(settings.enabledPlugins?.["dup@mkta"]).toBe(true);
      // Claude loads the skill from the plugin tree; Codex still gets it from the hub.
      expect(existsSync(join(context.homeDir, ".claude/skills/dup-skill/SKILL.md"))).toBe(false);
      expect(existsSync(join(context.homeDir, ".agents/skills/dup-skill/SKILL.md"))).toBe(true);

      setActiveProfileName("two");
      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.harnesses["claude-code"]?.plugins).toEqual([
        { id: "dup@mkta", state: "installed" },
      ]);
      expect(status.panel.reasons).not.toContain("missing_plugins");
    } finally {
      await context.cleanup();
    }
  });

  it("matches a bare pin to its @local install, not a marketplace pin", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-local-ref-"));
    try {
      mkdirSync(join(home, ".claude/plugins"), { recursive: true });
      writeFileSync(
        join(home, ".claude/plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "ponytail@local": [
              { scope: "user", installPath: "cache/local/ponytail/5.3.2", version: "5.3.2" },
            ],
          },
        }),
      );
      expect(buildHarnessPluginRows([{ ref: "ponytail", version_constraint: "*" }], home)).toEqual([
        { id: "ponytail", state: "installed" },
      ]);
      expect(
        buildHarnessPluginRows([{ ref: "ponytail@claude-plugins-official", version_constraint: "*" }], home),
      ).toEqual([
        { id: "ponytail@claude-plugins-official", state: "missing" },
        { id: "ponytail@local", state: "extra" },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

