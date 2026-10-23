import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  forgetMissingSettingsMarketplaces,
  isHarnessTapSettingsMarketplace,
  recordAddedSettingsMarketplaces,
  restoreForgottenSettingsMarketplaces,
} from "../../src/services/claude-settings-marketplaces.ts";
import {
  CLAUDE_SETTINGS_PATH,
  pruneClaudeRegistrations,
} from "../../src/services/claude-plugin-registration-prune.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("claude-settings-mkts-");
});
afterEach(async () => {
  await ctx.cleanup();
});

type Entry = { source: { source: string; repo: string } };
const entry = (repo: string): Entry => ({ source: { source: "github", repo } });

function settingsJson(markets: Record<string, Entry>): string {
  return `${JSON.stringify({ theme: "dark", extraKnownMarketplaces: markets }, null, 2)}\n`;
}

function writeSettings(markets: Record<string, Entry>): string {
  const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, settingsJson(markets));
  return path;
}

function installedJson(refs: string[]): string {
  const plugins = Object.fromEntries(refs.map((ref) => [ref, [{ scope: "user", installPath: join(ctx.homeDir, "x", ref), version: "1" }]]));
  return `${JSON.stringify({ version: 2, plugins }, null, 2)}\n`;
}

function strip(settings: string, installed: string, keep: string[] = []) {
  const result = pruneClaudeRegistrations(
    ctx.homeDir,
    { settings, installed },
    new Map(),
    new Set(keep),
    new Set(),
    { stripSettingsMarketplaces: true },
  );
  const out = result.files.get(CLAUDE_SETTINGS_PATH);
  return out === undefined ? undefined : (JSON.parse(out) as { theme?: string; extraKnownMarketplaces?: Record<string, Entry> });
}

describe("settings.json extraKnownMarketplaces provenance", () => {
  it("records only the entries a write added", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const before = settingsJson({ mine: entry("me/mine") });
    const after = settingsJson({ mine: entry("me/mine"), ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, before, after);
    expect(isHarnessTapSettingsMarketplace(path, "ht", entry("ht/ht"))).toBe(true);
    expect(isHarnessTapSettingsMarketplace(path, "mine", entry("me/mine"))).toBe(false);
  });

  it("does not own an entry the user changed after HarnessTap wrote it", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    recordAddedSettingsMarketplaces(path, settingsJson({}), settingsJson({ ht: entry("ht/ht") }));
    expect(isHarnessTapSettingsMarketplace(path, "ht", entry("someone/else"))).toBe(false);
  });
});

describe("switch-away strip of HarnessTap marketplaces", () => {
  it("drops the entry HarnessTap added and keeps the user's", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const settings = settingsJson({ mine: entry("me/mine"), ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({ mine: entry("me/mine") }), settings);
    const next = strip(settings, installedJson([]));
    expect(Object.keys(next?.extraKnownMarketplaces ?? {})).toEqual(["mine"]);
    expect(next?.theme).toBe("dark");
  });

  it("removes the whole key when HarnessTap's entries were all there was", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const settings = settingsJson({ ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({}), settings);
    const next = strip(settings, installedJson([]));
    expect(next).toBeDefined();
    expect(next?.extraKnownMarketplaces).toBeUndefined();
  });

  it("keeps an entry the user changed", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    recordAddedSettingsMarketplaces(path, settingsJson({}), settingsJson({ ht: entry("ht/ht") }));
    expect(strip(settingsJson({ ht: entry("user/own") }), installedJson([]))).toBeUndefined();
  });

  it("keeps an entry nobody recorded", () => {
    expect(strip(settingsJson({ ht: entry("ht/ht") }), installedJson([]))).toBeUndefined();
  });

  it("keeps the entry of a marketplace a plugin record still uses", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const settings = settingsJson({ ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({}), settings);
    expect(strip(settings, installedJson(["mine@ht"]))).toBeUndefined();
  });

  it("keeps the entry of a marketplace the apply keeps", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const settings = settingsJson({ ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({}), settings);
    expect(strip(settings, installedJson([]), ["ht"])).toBeUndefined();
  });

  it("does not strip unless asked to, as in the pending-apply path", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const settings = settingsJson({ ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({}), settings);
    const result = pruneClaudeRegistrations(ctx.homeDir, { settings, installed: installedJson([]) }, new Map());
    expect(result.files.has(CLAUDE_SETTINGS_PATH)).toBe(false);
  });
});

describe("revert of a stripped marketplace", () => {
  it("gives the restored entry back to HarnessTap, and forgets it when it goes again", () => {
    const path = writeSettings({ ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({}), settingsJson({ ht: entry("ht/ht") }));

    writeSettings({});
    forgetMissingSettingsMarketplaces(path, "SNAP1");
    expect(isHarnessTapSettingsMarketplace(path, "ht", entry("ht/ht"))).toBe(false);

    writeSettings({ ht: entry("ht/ht") });
    restoreForgottenSettingsMarketplaces(path, "SNAP1");
    expect(isHarnessTapSettingsMarketplace(path, "ht", entry("ht/ht"))).toBe(true);
  });

  it("does not give back an entry the user changed in between", () => {
    const path = writeSettings({ ht: entry("ht/ht") });
    recordAddedSettingsMarketplaces(path, settingsJson({}), settingsJson({ ht: entry("ht/ht") }));
    writeSettings({});
    forgetMissingSettingsMarketplaces(path, "SNAP2");

    writeSettings({ ht: entry("user/own") });
    restoreForgottenSettingsMarketplaces(path, "SNAP2");
    expect(isHarnessTapSettingsMarketplace(path, "ht", entry("user/own"))).toBe(false);
    expect(isHarnessTapSettingsMarketplace(path, "ht", entry("ht/ht"))).toBe(false);
  });
});
