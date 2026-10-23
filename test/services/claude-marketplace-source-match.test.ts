import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { applyClaudePluginExtensions } from "../../src/platforms/claude-plugin-extensions.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { addMarketplace, updateMarketplace } from "../../src/services/marketplace-registry.ts";
import { importPluginFromMarketplace } from "../../src/services/plugin-marketplace-import.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createTempDir } from "../helpers/fs.ts";

const KNOWN = ".claude/plugins/known_marketplaces.json";
const SETTINGS = ".claude/settings.json";

type Source = { source: string; repo?: string; url?: string };
type KnownFile = Record<string, { source: Source }>;
type SettingsFile = { extraKnownMarketplaces?: Record<string, { source: Source }> };

function readJson<T>(home: string, path: string): T {
  return JSON.parse(readFileSync(join(home, path), "utf-8")) as T;
}

/** A Claude-format marketplace repo `name` listing plugin `dup`. */
function initMarketplace(root: string, name: string): string {
  const repo = join(root, name);
  const plugin = join(repo, "plugins/dup");
  mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, "skills/dup-skill"), { recursive: true });
  writeFileSync(
    join(repo, ".claude-plugin/marketplace.json"),
    JSON.stringify({ name, owner: { name: "qa" }, plugins: [{ name: "dup", source: "./plugins/dup", description: "dup" }] }),
  );
  writeFileSync(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "dup", version: "1.0.0" }));
  writeFileSync(join(plugin, "skills/dup-skill/SKILL.md"), "---\nname: dup-skill\ndescription: dup\n---\ndup\n");
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["add", "-A"], { cwd: repo });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  return repo;
}

describe("known_marketplaces.json and extraKnownMarketplaces name the same source", () => {
  it("a profile that declares another repo for a marketplace HarnessTap registers gets the registered one in both files", async () => {
    const context = await createInitializedTestContext("claude-mkt-source-match");
    try {
      addMarketplace(getHarnesstapDir(), {
        url: initMarketplace(context.rootDir, "mkta"),
        name: "mkta",
        platforms: ["claude-code"],
      });
      await importPluginFromMarketplace({ marketplace: "mkta", plugin: "dup" });
      // HarnessTap fetches mkta from this repository ...
      updateMarketplace(getHarnesstapDir(), "mkta", { url: "https://github.com/org/registered.git" });
      // ... while the profile declares another repository under the same name.
      const profile = createPlugin({
        name: "remote",
        claude: { marketplaces: { mkta: { source: { source: "github", repo: "org/declared" } } } },
      });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "dup@mkta");
      setHarnessPreference({ registered_harnesses: ["claude-code"] });

      await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });

      const home = context.homeDir;
      const known = readJson<KnownFile>(home, KNOWN).mkta?.source;
      const declared = readJson<SettingsFile>(home, SETTINGS).extraKnownMarketplaces?.mkta?.source;
      expect(known).toEqual({ source: "github", repo: "org/registered" });
      expect(declared).toEqual(known);

      // A second apply keeps them equal, and the registration stays HarnessTap's.
      await applyProfilePlugin("remote", { harness: "claude-code", conflictPolicy: "replace", yes: true, pull: false });
      expect(readJson<SettingsFile>(home, SETTINGS).extraKnownMarketplaces?.mkta?.source).toEqual(known);
      expect(readJson<KnownFile>(home, KNOWN).mkta?.source).toEqual(known);
    } finally {
      await context.cleanup();
    }
  });
});

describe("applyClaudePluginExtensions declared sources", () => {
  const declared = { source: { source: "github", repo: "org/declared" } };
  const config = { marketplaces: { mkta: declared } };

  function knownEntry(home: string, source: Source, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      mkta: {
        source,
        installLocation: join(home, ".claude/plugins/harnesstap-marketplaces/mkta"),
        lastUpdated: "2026-01-01T00:00:00.000Z",
        autoUpdate: false,
        ...extra,
      },
    });
  }

  it("takes the source of the registration HarnessTap is writing in this apply", () => {
    const home = createTempDir("claude-ext-source-pending");
    const files = applyClaudePluginExtensions(
      [{ path: KNOWN, content: knownEntry(home, { source: "git", url: "https://example.invalid/mkta" }) }],
      config,
      home,
    );
    const settings = JSON.parse(files.find((file) => file.path === SETTINGS)?.content ?? "{}") as SettingsFile;
    expect(settings.extraKnownMarketplaces?.mkta?.source).toEqual({ source: "git", url: "https://example.invalid/mkta" });
  });

  it("keeps the declared source for a marketplace Claude Code added itself", () => {
    const home = createTempDir("claude-ext-source-foreign");
    mkdirSync(join(home, ".claude/plugins"), { recursive: true });
    writeFileSync(
      join(home, KNOWN),
      JSON.stringify({
        mkta: {
          source: { source: "github", repo: "org/declared" },
          installLocation: join(home, ".claude/plugins/marketplaces/mkta"),
          lastUpdated: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    const files = applyClaudePluginExtensions([], config, home);
    const settings = JSON.parse(files.find((file) => file.path === SETTINGS)?.content ?? "{}") as SettingsFile;
    expect(settings.extraKnownMarketplaces?.mkta?.source).toEqual(declared.source);
  });

  it("keeps the declared source when Claude Code rewrote the registration", () => {
    const home = createTempDir("claude-ext-source-changed");
    const files = applyClaudePluginExtensions(
      [{ path: KNOWN, content: knownEntry(home, { source: "git", url: "https://example.invalid/mkta" }, { autoUpdate: true }) }],
      config,
      home,
    );
    const settings = JSON.parse(files.find((file) => file.path === SETTINGS)?.content ?? "{}") as SettingsFile;
    expect(settings.extraKnownMarketplaces?.mkta?.source).toEqual(declared.source);
  });
});
