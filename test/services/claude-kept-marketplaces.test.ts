import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CLAUDE_SETTINGS_PATH,
  pruneClaudeRegistrations,
  pruneStaleClaudeRegistrationsOnDisk,
} from "../../src/services/claude-plugin-registration-prune.ts";
import { CLAUDE_KNOWN_MARKETPLACES_PATH } from "../../src/services/claude-marketplace-registration.ts";
import {
  isHarnessTapSettingsMarketplace,
  recordSettingsMarketplacesAddedBy,
} from "../../src/services/claude-settings-marketplaces.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("claude-kept-mkts-");
});
afterEach(async () => {
  await ctx.cleanup();
});

type Entry = { source: { source: string; repo: string } };
const entry = (repo: string): Entry => ({ source: { source: "github", repo } });

function settingsPath(): string {
  return join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readSettings(): { theme?: string; extraKnownMarketplaces?: Record<string, Entry> } {
  return JSON.parse(readFileSync(settingsPath(), "utf-8")) as { theme?: string; extraKnownMarketplaces?: Record<string, Entry> };
}

/** What `claude plugin marketplace add <repo>` does: clone the marketplace and declare it in settings.json. */
async function claudeAdds(name: string, repo: string): Promise<void> {
  const folder = join(ctx.homeDir, ".claude/plugins/marketplaces", name);
  mkdirSync(join(folder, ".claude-plugin"), { recursive: true });
  writeFileSync(join(folder, ".claude-plugin", "marketplace.json"), JSON.stringify({ name, owner: { name: "Someone" }, plugins: [] }));
  writeFileSync(join(folder, "README.md"), "x".repeat(2048));
  const knownPath = join(ctx.homeDir, CLAUDE_KNOWN_MARKETPLACES_PATH);
  const known = existsSync(knownPath) ? (JSON.parse(readFileSync(knownPath, "utf-8")) as Record<string, unknown>) : {};
  known[name] = { source: { source: "github", repo }, installLocation: folder, lastUpdated: "2026-01-01T00:00:00.000Z" };
  writeJson(knownPath, known);
  const settings = existsSync(settingsPath()) ? readSettings() : {};
  writeJson(settingsPath(), { ...settings, extraKnownMarketplaces: { ...settings.extraKnownMarketplaces, [name]: entry(repo) } });
}

describe("marketplaces a HarnessTap-started `claude plugin marketplace add` declared in settings.json", () => {
  it("records the entry the call added as HarnessTap's", async () => {
    writeJson(settingsPath(), { theme: "dark" });
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mkta", "org/mkta"));
    expect(isHarnessTapSettingsMarketplace(settingsPath(), "mkta", entry("org/mkta"))).toBe(true);
  });

  it("leaves an entry the file already had as the user's", async () => {
    writeJson(settingsPath(), { theme: "dark", extraKnownMarketplaces: { mkta: entry("org/mkta") } });
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mkta", "org/mkta"));
    expect(isHarnessTapSettingsMarketplace(settingsPath(), "mkta", entry("org/mkta"))).toBe(false);
  });

  it("records what the call added even when it fails", async () => {
    writeJson(settingsPath(), { theme: "dark" });
    await expect(recordSettingsMarketplacesAddedBy(ctx.homeDir, async () => {
      await claudeAdds("mkta", "org/mkta");
      throw new Error("claude exited 1");
    })).rejects.toThrow("claude exited 1");
    expect(isHarnessTapSettingsMarketplace(settingsPath(), "mkta", entry("org/mkta"))).toBe(true);
  });

  it("does nothing when there is no settings.json afterwards", async () => {
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, async () => undefined);
    expect(existsSync(settingsPath())).toBe(false);
  });
});

describe("a switch away from plugins whose marketplaces Claude Code cloned", () => {
  const sweep = (leaving: string[] = []) =>
    pruneStaleClaudeRegistrationsOnDisk(ctx.homeDir, new Map(), [], {
      applyId: "apply-kept-mkts",
      leavingMarketplaces: new Set(leaving),
    });

  it("strips the entries HarnessTap's marketplace add declared and names the kept clones", async () => {
    writeJson(settingsPath(), { theme: "dark" });
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mkta", "org/mkta"));
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mktb", "org/mktb"));
    const result = sweep(["mkta", "mktb"]);

    expect(readSettings().extraKnownMarketplaces).toBeUndefined();
    expect(readSettings().theme).toBe("dark");
    expect(result.rewritten).toContain(CLAUDE_SETTINGS_PATH);
    // The clones and their registrations are Claude Code's: never deleted.
    for (const name of ["mkta", "mktb"]) {
      expect(existsSync(join(ctx.homeDir, ".claude/plugins/marketplaces", name, "README.md"))).toBe(true);
    }
    const known = JSON.parse(readFileSync(join(ctx.homeDir, CLAUDE_KNOWN_MARKETPLACES_PATH), "utf-8")) as Record<string, unknown>;
    expect(Object.keys(known).sort()).toEqual(["mkta", "mktb"]);

    const notice = result.warnings.find((warning) => warning.startsWith("Kept these 2 marketplaces"));
    expect(notice).toBeDefined();
    expect(notice).toContain(join(ctx.homeDir, ".claude/plugins/marketplaces/mkta"));
    expect(notice).toContain(join(ctx.homeDir, ".claude/plugins/marketplaces/mktb"));
    expect(notice).toContain("claude plugin marketplace remove mkta");
  });

  it("keeps an entry the user changed after HarnessTap's marketplace add", async () => {
    writeJson(settingsPath(), { theme: "dark" });
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mkta", "org/mkta"));
    writeJson(settingsPath(), { theme: "dark", extraKnownMarketplaces: { mkta: entry("org/other") } });
    sweep(["mkta"]);
    expect(readSettings().extraKnownMarketplaces).toEqual({ mkta: entry("org/other") });
  });

  it("keeps an entry the user wrote and says nothing about a clone HarnessTap never triggered", async () => {
    writeJson(settingsPath(), { theme: "dark", extraKnownMarketplaces: { mkta: entry("org/mkta") } });
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mkta", "org/mkta"));
    const result = sweep();
    expect(readSettings().extraKnownMarketplaces).toEqual({ mkta: entry("org/mkta") });
    expect(result.warnings.filter((warning) => warning.startsWith("Kept"))).toEqual([]);
  });

  it("keeps the entry and says nothing while a plugin record still uses the marketplace", async () => {
    writeJson(settingsPath(), { theme: "dark" });
    await recordSettingsMarketplacesAddedBy(ctx.homeDir, () => claudeAdds("mkta", "org/mkta"));
    const installed = `${JSON.stringify({ version: 2, plugins: { "tool@mkta": [{ scope: "user", installPath: join(ctx.homeDir, "elsewhere"), version: "1" }] } })}\n`;
    const pruned = pruneClaudeRegistrations(
      ctx.homeDir,
      { settings: readFileSync(settingsPath(), "utf-8"), installed },
      new Map(),
      new Set(),
      new Set(),
      { stripSettingsMarketplaces: true, leavingMarketplaces: new Set(["mkta"]) },
    );
    expect(pruned.files.has(CLAUDE_SETTINGS_PATH)).toBe(false);
  });
});
