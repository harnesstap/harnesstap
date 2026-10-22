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
import {
  detectGlobalProfileStatus,
  globalProfileStatusGaps,
} from "../../src/services/global-profile-drift.ts";
import {
  buildHarnessPluginRows,
  filesOnlyMarketplacePinRefs,
} from "../../src/services/global-profile-status-panel.ts";
import { addMarketplace, updateMarketplace } from "../../src/services/marketplace-registry.ts";
import { importPluginFromMarketplace } from "../../src/services/plugin-marketplace-import.ts";
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

  it("does not report a remote marketplace dependency applied as files as a missing plugin", async () => {
    const context = await createInitializedTestContext("claude-host-plugin-remote-mkt");
    try {
      const repo = initLocalClaudeMarketplace(context.rootDir, "mkta");
      addMarketplace(getHarnesstapDir(), { url: repo, name: "mkta", platforms: ["claude-code"] });
      await importPluginFromMarketplace({ marketplace: "mkta", plugin: "dup" });
      const profile = createPlugin({ name: "remote" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "dup@mkta");
      // Same library plugin, but its marketplace is now remote: apply writes the
      // skill as a file and leaves the Claude install to Claude (B6).
      updateMarketplace(getHarnesstapDir(), "mkta", { url: "https://example.invalid/qa/mkta.git" });
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      const applied = await applyProfilePlugin("remote", {
        harness: "claude-code",
        conflictPolicy: "replace",
        yes: true,
        pull: false,
      });
      expect(applied.cancelled).toBe(false);
      expect(applied.resolution && [...filesOnlyMarketplacePinRefs(applied.resolution)]).toEqual([
        "dup@mkta",
      ]);
      expect(existsSync(join(context.homeDir, ".claude/skills/dup-skill/SKILL.md"))).toBe(true);
      expect(existsSync(join(context.homeDir, ".claude/plugins/installed_plugins.json"))).toBe(false);

      setActiveProfileName("remote");
      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.has_drift).toBe(false);
      expect(status.harnesses["claude-code"]?.plugins).toEqual([]);
      expect(status.panel.reasons).not.toContain("missing_plugins");
      expect(status.panel.status).toBe("green");
      expect(globalProfileStatusGaps(status)).toEqual({ inSync: true, missing: [] });
    } finally {
      await context.cleanup();
    }
  });

  it("reports a registered plugin Claude no longer has as out of sync in every status view", async () => {
    const context = await createInitializedTestContext("claude-host-plugin-unregistered");
    try {
      const repo = initLocalClaudeMarketplace(context.rootDir, "mkta");
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

      // Claude uninstalled it: the registry entry is gone.
      writeFileSync(
        join(context.homeDir, ".claude/plugins/installed_plugins.json"),
        `${JSON.stringify({ version: 2, plugins: {} }, null, 2)}\n`,
      );

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.harnesses["claude-code"]?.plugins).toEqual([
        { id: "dup@mkta", state: "missing" },
      ]);
      expect(status.panel.reasons).toContain("missing_plugins");
      expect(globalProfileStatusGaps(status)).toEqual({
        inSync: false,
        missing: [{ harness: "claude-code", kind: "plugin", id: "dup@mkta" }],
      });
    } finally {
      await context.cleanup();
    }
  });

  it("only skips a missing host install for pins the apply wrote as files", () => {
    const home = mkdtempSync(join(tmpdir(), "claude-files-only-pins-"));
    try {
      mkdirSync(join(home, ".claude/plugins"), { recursive: true });
      writeFileSync(
        join(home, ".claude/plugins/installed_plugins.json"),
        JSON.stringify({
          version: 2,
          plugins: {
            "context7@claude-plugins-official": [
              { scope: "user", installPath: "cache/claude-plugins-official/context7/1.0.0", version: "1.0.0" },
            ],
          },
        }),
      );
      const pins = [
        { ref: "superpowers@claude-plugins-official", version_constraint: "7.0.0" },
        { ref: "context7@claude-plugins-official", version_constraint: "1.0.0" },
        { ref: "demo@demo-market", version_constraint: "1.0.0" },
      ];
      const filesOnly = new Set([
        "superpowers@claude-plugins-official",
        "context7@claude-plugins-official",
      ]);
      expect(buildHarnessPluginRows(pins, home, filesOnly)).toEqual([
        // superpowers: written as files and Claude has not installed it, so no row.
        // context7: Claude installed it itself, so it is still reported, not "extra".
        { id: "context7@claude-plugins-official", state: "installed" },
        // demo: the apply did not write it, so Claude must install it.
        { id: "demo@demo-market", state: "missing" },
      ]);
      // Without the apply's resolution every declared pin counts.
      expect(buildHarnessPluginRows(pins, home).map((row) => row.state)).toEqual([
        "missing",
        "installed",
        "missing",
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
