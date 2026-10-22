import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, spyOn } from "bun:test";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { addMarketplace, updateMarketplace } from "../../src/services/marketplace-registry.ts";
import { importPluginFromMarketplace } from "../../src/services/plugin-marketplace-import.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { isClaudePluginRegistryPath } from "../../src/services/claude-plugin-registration-prune.ts";
import { isHarnessTapClaudeRecord } from "../../src/services/claude-plugin-record-owner.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { maybeSyncActiveProfileBeforeSwitch } from "../../src/services/profile-switch-prompt.ts";
import { detectGlobalProfileStatus, hostPluginFolderChanges } from "../../src/services/global-profile-drift.ts";
import { recordHostPluginViewFiles } from "../../src/services/package-cache/host-plugin-views.ts";
import { hashFileOrLink } from "../../src/services/safe-file-removal.ts";
import { getLatestGlobalApplySnapshotForProfile } from "../../src/models/global-apply-snapshot.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const INSTALLED = ".claude/plugins/installed_plugins.json";
const KNOWN = ".claude/plugins/known_marketplaces.json";
const SETTINGS = ".claude/settings.json";

/** A Claude-format marketplace repo listing plugin `dup` (skill, hook, MCP server). */
function initMarketplace(root: string, name: string, extras = false): string {
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
  if (extras) {
    mkdirSync(join(plugin, "assets"), { recursive: true });
    writeFileSync(join(plugin, "hooks/start.sh"), "#!/bin/sh\necho start\n");
    writeFileSync(join(plugin, "assets/logo.bin"), Buffer.from([0, 1, 2, 3]));
  }
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  return repo;
}

/** Profile `remote` depending on dup@mkta, with mkta then pointed at a remote URL. */
async function setupRemoteProfile(rootDir: string, extras = false): Promise<void> {
  addMarketplace(getHarnesstapDir(), { url: initMarketplace(rootDir, "mkta", extras), name: "mkta", platforms: ["claude-code"] });
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

  it("takes its enabledPlugins key out of a settings.json that existed first, with no installed_plugins.json of the user's", async () => {
    const context = await createInitializedTestContext("claude-remote-reg-settings-only");
    try {
      const home = context.homeDir;
      writeJson(home, SETTINGS, { theme: "dark", enabledPlugins: { "mine@elsewhere": true } });
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(readJson<{ enabledPlugins: Record<string, boolean> }>(home, SETTINGS).enabledPlugins).toEqual({
        "mine@elsewhere": true,
        "dup@mkta": true,
      });

      await applyProfilePlugin("plain", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(existsSync(join(home, INSTALLED))).toBe(false);
      expect(readJson<object>(home, SETTINGS)).toEqual({ theme: "dark", enabledPlugins: { "mine@elsewhere": true } });
    } finally {
      await context.cleanup();
    }
  });

  it("writes only the files Claude reads into a plugin folder HarnessTap mirrored, and removes the whole folder on switch", async () => {
    const context = await createInitializedTestContext("claude-remote-reg-mirror");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir, true);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      const cacheDir = readJson<{ plugins: Record<string, Array<{ installPath: string }>> }>(home, INSTALLED)
        .plugins["dup@mkta"]?.[0]?.installPath ?? "";
      // What the package download leaves: a copy HarnessTap made and recorded file by file.
      const files: Record<string, string> = {};
      for (const entry of readdirSync(cacheDir, { recursive: true }) as string[]) {
        const hash = hashFileOrLink(join(cacheDir, entry));
        if (hash && statSync(join(cacheDir, entry)).isFile()) files[entry.split("\\").join("/")] = hash;
      }
      recordHostPluginViewFiles({ hostView: cacheDir, created: true, files });

      await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      const written = Object.keys(
        getLatestGlobalApplySnapshotForProfile("remote")?.state?.platform_files["claude-code"] ?? {},
      ).filter((path) => join(home, path).startsWith(`${cacheDir}/`))
        .map((path) => join(home, path).slice(cacheDir.length + 1))
        .sort();
      expect(written).toEqual([".claude-plugin/plugin.json", ".mcp.json", "hooks/hooks.json", "skills/dup-skill/SKILL.md"]);
      expect(existsSync(join(cacheDir, "hooks/start.sh"))).toBe(true);
      expect(existsSync(join(cacheDir, "assets/logo.bin"))).toBe(true);

      await applyProfilePlugin("plain", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(existsSync(cacheDir)).toBe(false);
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

describe("claude marketplace entries Claude Code changed", () => {
  const MANIFEST_DIR = ".claude/plugins/harnesstap-marketplaces/mkta";
  type Entry = { source?: unknown; installLocation?: string; lastUpdated?: string; autoUpdate?: boolean };

  async function applyRemote(): Promise<void> {
    await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
    setActiveProfileName("remote");
  }

  async function switchToPlain(): Promise<string[]> {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await applyProfilePlugin("plain", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      return warn.mock.calls.map((call) => String(call[0]));
    } finally {
      warn.mockRestore();
    }
  }

  it("turns auto-update off and keeps the entry bytes on a re-apply", async () => {
    const context = await createInitializedTestContext("claude-mp-autoupdate");
    try {
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const first = readFileSync(join(context.homeDir, KNOWN), "utf-8");
      expect(readJson<Record<string, Entry>>(context.homeDir, KNOWN).mkta?.autoUpdate).toBe(false);
      await applyRemote();
      expect(readFileSync(join(context.homeDir, KNOWN), "utf-8")).toBe(first);
      expect((await detectGlobalProfileStatus({ harness: "claude-code" })).has_drift).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("turns auto-update off on an entry an earlier version wrote without it, and still removes it on switch", async () => {
    const context = await createInitializedTestContext("claude-mp-legacy");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const known = readJson<Record<string, Entry>>(home, KNOWN);
      delete known.mkta?.autoUpdate;
      writeJson(home, KNOWN, { ...known, "my-mp": { source: { source: "github", repo: "me/my-mp" }, installLocation: "/x", lastUpdated: "t" } });
      await applyRemote();
      expect(readJson<Record<string, Entry>>(home, KNOWN).mkta?.autoUpdate).toBe(false);

      const warnings = await switchToPlain();
      expect(Object.keys(readJson<object>(home, KNOWN))).toEqual(["my-mp"]);
      expect(warnings.some((line) => line.includes("Claude Code changed"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("reports and keeps an entry a Claude Code marketplace refresh repointed at its own clone", async () => {
    const context = await createInitializedTestContext("claude-mp-refreshed");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      // What `claude plugin marketplace update` leaves for a third-party marketplace.
      const refreshed: Entry = {
        source: { source: "git", url: "https://example.invalid/qa/mkta.git" },
        installLocation: join(home, ".claude/plugins/marketplaces/mkta"),
        lastUpdated: "2026-10-22T23:00:00.000Z",
      };
      writeJson(home, KNOWN, { ...readJson<object>(home, KNOWN), mkta: refreshed });

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.has_drift).toBe(false);
      expect(status.changes.filter((change) => change.path === KNOWN)).toEqual([
        { path: KNOWN, type: "modified", removal_group: "owned_modified", changed_by: "claude-code", detail: "marketplace mkta" },
      ]);

      // A re-apply leaves the entry as Claude Code wrote it.
      await applyRemote();
      expect(readJson<Record<string, Entry>>(home, KNOWN).mkta).toEqual(refreshed);
      expect(existsSync(join(home, MANIFEST_DIR, ".claude-plugin/marketplace.json"))).toBe(true);

      // Claude Code's change is not an unsaved profile change that blocks a switch.
      expect(await maybeSyncActiveProfileBeforeSwitch({ targetProfileName: "plain", harness: "claude-code", yes: true })).toBe("continue");

      const warnings = await switchToPlain();
      expect(readJson<Record<string, Entry>>(home, KNOWN).mkta).toEqual(refreshed);
      expect(warnings.some((line) => line.includes("Claude Code changed the entry for marketplace mkta"))).toBe(true);
      // HarnessTap's own record (the only one, so the whole file) and folders still go.
      expect(existsSync(join(home, INSTALLED))).toBe(false);
      expect(existsSync(join(home, MANIFEST_DIR))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("reports and keeps an entry whose auto-update Claude Code turned on", async () => {
    const context = await createInitializedTestContext("claude-mp-autoupdate-on");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const known = readJson<Record<string, Entry>>(home, KNOWN);
      const changed = { ...known.mkta, autoUpdate: true };
      writeJson(home, KNOWN, { ...known, mkta: changed });

      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.has_drift).toBe(false);
      expect(status.changes.some((change) => change.detail === "marketplace mkta" && change.changed_by === "claude-code")).toBe(true);
      await applyRemote();
      expect(readJson<Record<string, Entry>>(home, KNOWN).mkta).toEqual(changed);

      const warnings = await switchToPlain();
      expect(readJson<Record<string, Entry>>(home, KNOWN).mkta).toEqual(changed);
      expect(warnings.some((line) => line.includes("claude plugin marketplace remove mkta"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("reports a marketplace manifest HarnessTap wrote that changed since as kept, changed by Claude Code", async () => {
    const context = await createInitializedTestContext("claude-mp-manifest-changed");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      writeFileSync(join(home, MANIFEST_DIR, ".claude-plugin/marketplace.json"), "{}\n");
      const status = await detectGlobalProfileStatus({ harness: "claude-code" });
      expect(status.has_drift).toBe(false);
      expect(status.changes).toContainEqual({
        path: `${MANIFEST_DIR}/.claude-plugin/marketplace.json`,
        type: "modified",
        removal_group: "owned_modified",
        changed_by: "claude-code",
      });
      // The switch keeps it rather than deleting a file that changed.
      await switchToPlain();
      expect(readFileSync(join(home, MANIFEST_DIR, ".claude-plugin/marketplace.json"), "utf-8")).toBe("{}\n");
    } finally {
      await context.cleanup();
    }
  });
});

describe("plugins the user installed from a HarnessTap marketplace", () => {
  const MANIFEST_DIR = ".claude/plugins/harnesstap-marketplaces/mkta";
  type Rows = { plugins: Record<string, Array<Record<string, unknown>>> };

  async function applyRemote(): Promise<void> {
    await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
    setActiveProfileName("remote");
  }

  async function switchToPlain(): Promise<string[]> {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await applyProfilePlugin("plain", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      return warn.mock.calls.map((call) => String(call[0]));
    } finally {
      warn.mockRestore();
    }
  }

  /**
   * What `claude plugin install dup@mkta` leaves after the marketplace was
   * refreshed: the same cache folder, now with a record Claude Code wrote.
   */
  function userInstalls(home: string, repointMarketplace: boolean): { cacheDir: string; record: Record<string, unknown> } {
    const rows = readJson<Rows>(home, INSTALLED);
    const cacheDir = String(rows.plugins["dup@mkta"]?.[0]?.installPath);
    const record = {
      scope: "user",
      installPath: cacheDir,
      version: "1.0.0",
      installedAt: "2026-10-22T23:17:11.448Z",
      lastUpdated: "2026-10-22T23:17:11.448Z",
      gitCommitSha: "2c606141936f1eeef17fa3043a72095b4765b9c2",
    };
    rows.plugins["dup@mkta"] = [record];
    writeJson(home, INSTALLED, rows);
    mkdirSync(join(cacheDir, ".in_use"), { recursive: true });
    writeFileSync(join(cacheDir, "notes.txt"), "mine\n");
    writeJson(home, SETTINGS, { enabledPlugins: { "dup@mkta": true } });
    if (repointMarketplace) {
      const known = readJson<Record<string, Record<string, unknown>>>(home, KNOWN);
      known.mkta = { ...known.mkta, installLocation: join(home, ".claude/plugins/marketplaces/mkta") };
      writeJson(home, KNOWN, known);
    }
    return { cacheDir, record };
  }

  it("keeps the record, the enabled key, the cache folder and the marketplace entry on switch away", async () => {
    const context = await createInitializedTestContext("claude-user-install-switch");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const { cacheDir, record } = userInstalls(home, true);
      const known = readFileSync(join(home, KNOWN), "utf-8");
      const settings = readFileSync(join(home, SETTINGS), "utf-8");

      const warnings = await switchToPlain();
      expect(readJson<Rows>(home, INSTALLED).plugins).toEqual({ "dup@mkta": [record] });
      expect(readFileSync(join(home, KNOWN), "utf-8")).toBe(known);
      expect(readFileSync(join(home, SETTINGS), "utf-8")).toBe(settings);
      expect(existsSync(join(cacheDir, ".claude-plugin/plugin.json"))).toBe(true);
      expect(readFileSync(join(cacheDir, "notes.txt"), "utf-8")).toBe("mine\n");
      expect(warnings.some((line) => line.includes("claude plugin uninstall dup@mkta"))).toBe(true);
      expect(warnings.some((line) => line.includes("claude plugin marketplace remove mkta"))).toBe(true);

      // The folder is the user's now: a later switch removes nothing in it.
      await applyRemote();
      await switchToPlain();
      expect(existsSync(join(cacheDir, ".claude-plugin/plugin.json"))).toBe(true);
      expect(readJson<Rows>(home, INSTALLED).plugins).toEqual({ "dup@mkta": [record] });
    } finally {
      await context.cleanup();
    }
  });

  it("keeps HarnessTap's marketplace folder while the user's marketplace entry still points at it", async () => {
    const context = await createInitializedTestContext("claude-user-install-ht-marketplace");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const { record } = userInstalls(home, false);
      const known = readFileSync(join(home, KNOWN), "utf-8");

      await switchToPlain();
      expect(existsSync(join(home, MANIFEST_DIR, ".claude-plugin/marketplace.json"))).toBe(true);
      expect(readFileSync(join(home, KNOWN), "utf-8")).toBe(known);
      expect(readJson<Rows>(home, INSTALLED).plugins).toEqual({ "dup@mkta": [record] });
    } finally {
      await context.cleanup();
    }
  });

  it("leaves the user's install and its folder alone when the profile is applied again", async () => {
    const context = await createInitializedTestContext("claude-user-install-reapply");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const { cacheDir, record } = userInstalls(home, true);
      writeFileSync(join(cacheDir, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "1.0.0", note: "user" }));
      const bytes = readFileSync(join(cacheDir, ".claude-plugin/plugin.json"), "utf-8");

      await applyRemote();
      expect(readJson<Rows>(home, INSTALLED).plugins).toEqual({ "dup@mkta": [record] });
      expect(readFileSync(join(cacheDir, ".claude-plugin/plugin.json"), "utf-8")).toBe(bytes);
      expect(readFileSync(join(cacheDir, "notes.txt"), "utf-8")).toBe("mine\n");
    } finally {
      await context.cleanup();
    }
  });

  it("still removes HarnessTap's own record shape, and tells the two apart by the record, not the marketplace", async () => {
    const context = await createInitializedTestContext("claude-user-install-owner");
    try {
      const home = context.homeDir;
      await setupRemoteProfile(context.rootDir);
      setHarnessPreference({ registered_harnesses: ["claude-code"] });
      await applyRemote();
      const ref = "dup@mkta";
      const own = readJson<Rows>(home, INSTALLED).plugins[ref]?.[0] ?? {};
      expect(isHarnessTapClaudeRecord(home, own)).toBe(true);
      expect(isHarnessTapClaudeRecord(home, { ...own, gitCommitSha: "abc" })).toBe(false);
      expect(isHarnessTapClaudeRecord(home, { ...own, scope: "project" })).toBe(false);
      expect(isHarnessTapClaudeRecord(home, { ...own, installPath: join(home, "elsewhere") })).toBe(false);
      expect(isHarnessTapClaudeRecord(home, "x")).toBe(false);

      await switchToPlain();
      expect(existsSync(join(home, INSTALLED))).toBe(false);
      expect(existsSync(join(String(own.installPath), ".claude-plugin/plugin.json"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
