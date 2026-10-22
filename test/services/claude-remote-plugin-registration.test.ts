import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { addMarketplace, updateMarketplace } from "../../src/services/marketplace-registry.ts";
import { importPluginFromMarketplace } from "../../src/services/plugin-marketplace-import.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { isClaudePluginRegistryPath } from "../../src/services/claude-plugin-registration-prune.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { detectGlobalProfileStatus, hostPluginFolderChanges } from "../../src/services/global-profile-drift.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const INSTALLED = ".claude/plugins/installed_plugins.json";
const KNOWN = ".claude/plugins/known_marketplaces.json";
const SETTINGS = ".claude/settings.json";

/** A Claude-format marketplace repo listing plugin `dup` (skill, hook, MCP server). */
function initMarketplace(root: string, name: string): string {
  const repo = join(root, name);
  const plugin = join(repo, "plugins/dup");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "skills/dup-skill"), { recursive: true });
  mkdirSync(join(plugin, "hooks"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({
      name,
      owner: { name: "qa" },
      plugins: [{ name: "dup", source: "./plugins/dup", description: "dup" }],
    }),
  );
  writeFileSync(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "1.0.0" }));
  writeFileSync(join(plugin, "skills/dup-skill/SKILL.md"), "---\nname: dup-skill\ndescription: dup\n---\ndup\n");
  writeFileSync(
    join(plugin, "hooks/hooks.json"),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/start.sh" }] }] } }),
  );
  writeFileSync(
    join(plugin, ".mcp.json"),
    JSON.stringify({ mcpServers: { dupmcp: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"] } } }),
  );
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  return repo;
}

/** Profile `remote` depending on dup@mkta, with mkta then pointed at a remote URL. */
async function setupRemoteProfile(rootDir: string): Promise<void> {
  addMarketplace(getHarnesstapDir(), { url: initMarketplace(rootDir, "mkta"), name: "mkta", platforms: ["claude-code"] });
  await importPluginFromMarketplace({ marketplace: "mkta", plugin: "dup" });
  const profile = createPlugin({ name: "remote" });
  setPluginTags(profile.id, ["profile"]);
  addDependency(profile.id, "dup@mkta");
  updateMarketplace(getHarnesstapDir(), "mkta", { url: "https://example.invalid/qa/mkta.git" });
  const empty = createPlugin({ name: "plain" });
  setPluginTags(empty.id, ["profile"]);
}

function readJson<T>(home: string, path: string): T {
  return JSON.parse(readFileSync(join(home, path), "utf-8")) as T;
}

function writeJson(home: string, path: string, value: unknown): void {
  mkdirSync(join(home, path, ".."), { recursive: true });
  writeFileSync(join(home, path), `${JSON.stringify(value, null, 2)}\n`);
}

function findFiles(root: string, name: string): string[] {
  if (!existsSync(root)) return [];
  return (readdirSync(root, { recursive: true }) as string[]).filter((entry) => entry.endsWith(name));
}

describe("claude remote marketplace plugin registration", () => {
  it("registers for Claude Code with hooks and MCP, and keeps standalone skills for Cursor", async () => {
    const context = await createInitializedTestContext("claude-remote-reg-apply");
    try {
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code", "cursor"] });
      const applied = await applyProfilePlugin("remote", {
        harness: "claude-code,cursor",
        conflictPolicy: "replace",
        yes: true,
        pull: false,
      });
      expect(applied.cancelled).toBe(false);

      const home = context.homeDir;
      const installPath = readJson<{ plugins: Record<string, Array<{ installPath: string }>> }>(home, INSTALLED)
        .plugins["dup@mkta"]?.[0]?.installPath ?? "";
      expect(installPath.startsWith("/")).toBe(true);
      expect(existsSync(join(installPath, "hooks/hooks.json"))).toBe(true);
      const mcp = readJson<{ mcpServers: Record<string, { args: string[] }> }>(installPath, ".mcp.json");
      expect(mcp.mcpServers.dupmcp?.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/server.js"]);

      const manifest = readJson<{ plugins: Array<{ name: string; source: string }> }>(
        home,
        ".claude/plugins/harnesstap-marketplaces/mkta/.claude-plugin/marketplace.json",
      );
      expect(manifest.plugins.map((plugin) => plugin.name)).toEqual(["dup"]);
      expect(readJson<Record<string, { source: unknown }>>(home, KNOWN).mkta?.source).toEqual({
        source: "git",
        url: "https://example.invalid/qa/mkta",
      });
      // Claude Code rejects known_marketplaces.json when an entry has no lastUpdated.
      const firstUpdated = readJson<Record<string, { lastUpdated?: string }>>(home, KNOWN).mkta?.lastUpdated;
      expect(typeof firstUpdated).toBe("string");
      await applyProfilePlugin("remote", { harness: "claude-code,cursor", conflictPolicy: "replace", yes: true, pull: false });
      expect(readJson<Record<string, { lastUpdated?: string }>>(home, KNOWN).mkta?.lastUpdated).toBe(firstUpdated);

      // No standalone copy for Claude Code; Cursor delivery is unchanged.
      expect(findFiles(join(home, ".claude/skills"), "dup-skill/SKILL.md")).toEqual([]);
      const claudeJson = existsSync(join(home, ".claude.json")) ? readFileSync(join(home, ".claude.json"), "utf-8") : "";
      expect(claudeJson.includes("dupmcp")).toBe(false);
      expect(
        findFiles(join(home, ".cursor"), "dup-skill/SKILL.md").length
          + findFiles(join(home, ".agents"), "dup-skill/SKILL.md").length,
      ).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("switching away removes only HarnessTap's registrations and keeps the user's keys", async () => {
    const context = await createInitializedTestContext("claude-remote-reg-switch");
    try {
      const home = context.homeDir;
      writeJson(home, INSTALLED, {
        version: 2,
        plugins: { "foo@my-mp": [{ scope: "user", installPath: join(home, ".claude/plugins/cache/my-mp/foo/1.0.0"), version: "1.0.0" }] },
      });
      writeJson(home, KNOWN, {
        "my-mp": { source: { source: "github", repo: "me/my-mp" }, installLocation: join(home, ".claude/plugins/marketplaces/my-mp") },
      });
      writeJson(home, SETTINGS, { theme: "dark", enabledPlugins: { "foo@my-mp": true } });
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      const during = readJson<{ plugins: Record<string, Array<{ installPath: string }>> }>(home, INSTALLED);
      expect(Object.keys(during.plugins).sort()).toEqual(["dup@mkta", "foo@my-mp"]);
      const cacheDir = during.plugins["dup@mkta"]?.[0]?.installPath ?? "";
      expect(existsSync(cacheDir)).toBe(true);

      await applyProfilePlugin("plain", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(Object.keys(readJson<{ plugins: object }>(home, INSTALLED).plugins)).toEqual(["foo@my-mp"]);
      expect(Object.keys(readJson<object>(home, KNOWN))).toEqual(["my-mp"]);
      expect(readJson<object>(home, SETTINGS)).toEqual({ theme: "dark", enabledPlugins: { "foo@my-mp": true } });
      expect(existsSync(cacheDir)).toBe(false);
      expect(existsSync(join(home, ".claude/plugins/harnesstap-marketplaces/mkta"))).toBe(false);
      // The pre-change registries are backed up.
      expect(findFiles(join(getHarnesstapDir(), "trash"), "installed_plugins.json").length).toBeGreaterThan(0);
    } finally {
      await context.cleanup();
    }
  });

  it("leaves a Claude Code install of the same plugin that HarnessTap did not make", async () => {
    const context = await createInitializedTestContext("claude-remote-reg-foreign");
    try {
      const home = context.homeDir;
      const ownRoot = join(home, ".claude/plugins/cache/mkta/dup/0.9.0");
      mkdirSync(join(ownRoot, ".claude-plugin"), { recursive: true });
      writeFileSync(join(ownRoot, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "0.9.0" }));
      const record = { scope: "user", installPath: ownRoot, version: "0.9.0", gitCommitSha: "abc" };
      writeJson(home, INSTALLED, { version: 2, plugins: { "dup@mkta": [record] } });
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      const applied = await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(applied.cancelled).toBe(false);
      expect(readJson<{ plugins: object }>(home, INSTALLED).plugins).toEqual({ "dup@mkta": [record] });
      expect(existsSync(join(home, ".claude/plugins/harnesstap-marketplaces/mkta"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("compares an agent-plugins spec plugin to its translated tree and still sees user edits", async () => {
    const context = await createInitializedTestContext("claude-remote-reg-spec");
    try {
      const repo = join(context.rootDir, "spec-mp");
      mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
      mkdirSync(join(repo, "plugins/specplug"), { recursive: true });
      writeFileSync(
        join(repo, ".claude-plugin/marketplace.json"),
        JSON.stringify({ name: "spec-mp", owner: { name: "qa" }, plugins: [{ name: "specplug", source: "./plugins/specplug" }] }),
      );
      writeFileSync(
        join(repo, "plugins/specplug/plugin.json"),
        JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "specplug", version: "1.0.0" }),
      );
      writeFileSync(
        join(repo, "plugins/specplug/mcp.json"),
        JSON.stringify({ mcpServers: { specmcp: { command: "npx", args: ["spec-server@latest"] } } }),
      );
      spawnSync("git", ["init", "-q"], { cwd: repo });
      spawnSync("git", ["add", "-A"], { cwd: repo });
      spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
      addMarketplace(getHarnesstapDir(), { url: repo, name: "spec-mp", platforms: ["claude-code"] });
      await importPluginFromMarketplace({ marketplace: "spec-mp", plugin: "specplug" });
      const profile = createPlugin({ name: "spec" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "specplug@spec-mp");
      updateMarketplace(getHarnesstapDir(), "spec-mp", { url: "https://example.invalid/qa/spec-mp.git" });
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      await applyProfilePlugin("spec", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      setActiveProfileName("spec");
      const installPath = readJson<{ plugins: Record<string, Array<{ installPath: string }>> }>(context.homeDir, INSTALLED)
        .plugins["specplug@spec-mp"]?.[0]?.installPath ?? "";
      expect(existsSync(join(installPath, ".mcp.json"))).toBe(true);
      const inSync = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(inSync.has_drift).toBe(false);
      expect(inSync.changes.filter((change) => change.path.includes("specplug"))).toEqual([]);

      const planned = await applyProfilePlugin("spec", { harness: "claude-code", dryRun: true });
      expect(hostPluginFolderChanges(context.homeDir, planned.expected_files ?? [], [])).toEqual([]);

      // A user edit is still reported (and kept), not hidden by the translation.
      writeFileSync(join(installPath, ".mcp.json"), JSON.stringify({ mcpServers: {} }));
      expect(
        hostPluginFolderChanges(context.homeDir, planned.expected_files ?? [], []).map((change) => change.path),
      ).toEqual([".claude/plugins/cache/spec-mp/specplug/1.0.0/.mcp.json"]);
    } finally {
      await context.cleanup();
    }
  });

  it("recognizes only Claude Code's plugin registries", () => {
    expect(isClaudePluginRegistryPath(INSTALLED)).toBe(true);
    expect(isClaudePluginRegistryPath(KNOWN)).toBe(true);
    expect(isClaudePluginRegistryPath(".claude\\plugins\\installed_plugins.json")).toBe(true);
    expect(isClaudePluginRegistryPath(SETTINGS)).toBe(false);
    expect(isClaudePluginRegistryPath(".cursor/plugins/installed.json")).toBe(false);
  });
});
