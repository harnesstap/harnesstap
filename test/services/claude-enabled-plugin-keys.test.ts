import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  forgetMissingEnabledKeys,
  isClaudeSettingsPath,
  isHarnessTapEnabledKey,
  recordAddedEnabledKeys,
  restoreForgottenEnabledKeys,
} from "../../src/services/claude-enabled-plugin-keys.ts";
import {
  pruneClaudeRegistrations,
  CLAUDE_SETTINGS_PATH,
} from "../../src/services/claude-plugin-registration-prune.ts";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import { tryEditAggregateContent } from "../../src/services/host-config-strip.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import type { Resource } from "../../src/types.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("claude-enabled-keys-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function settingsJson(enabled: Record<string, boolean>): string {
  return `${JSON.stringify({ theme: "dark", enabledPlugins: enabled }, null, 2)}\n`;
}

describe("claude enabledPlugins key provenance", () => {
  it("records only the keys a write added, never a key the file already had", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    const before = settingsJson({ "mine@mkt": true, "ht@mkt": false });
    const after = settingsJson({ "mine@mkt": true, "ht@mkt": false, "new@mkt": true });
    recordAddedEnabledKeys(path, before, after);

    expect(isHarnessTapEnabledKey(path, "new@mkt")).toBe(true);
    expect(isHarnessTapEnabledKey(path, "mine@mkt")).toBe(false);
    expect(isHarnessTapEnabledKey(path, "ht@mkt")).toBe(false);
  });

  it("records every key of a file the write created", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    recordAddedEnabledKeys(path, undefined, settingsJson({ "a@mkt": true }));
    expect(isHarnessTapEnabledKey(path, "a@mkt")).toBe(true);
  });

  it("forgets a key that left the file and saves it for the snapshot", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    writeTextFile(path, settingsJson({ "a@mkt": true, "b@mkt": true }));
    recordAddedEnabledKeys(path, undefined, settingsJson({ "a@mkt": true, "b@mkt": true }));
    writeTextFile(path, settingsJson({ "b@mkt": true }));

    forgetMissingEnabledKeys(path, "SNAP1");

    expect(isHarnessTapEnabledKey(path, "a@mkt")).toBe(false);
    expect(isHarnessTapEnabledKey(path, "b@mkt")).toBe(true);
    expect(existsSync(join(getHarnesstapDir(), "cache", "removed-ownership", "SNAP1.enabled.json"))).toBe(true);
  });

  it("gives a key back to HarnessTap when a revert puts it back", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    writeTextFile(path, settingsJson({ "a@mkt": true }));
    recordAddedEnabledKeys(path, undefined, settingsJson({ "a@mkt": true }));
    writeTextFile(path, settingsJson({}));
    forgetMissingEnabledKeys(path, "SNAP2");
    expect(isHarnessTapEnabledKey(path, "a@mkt")).toBe(false);

    writeTextFile(path, settingsJson({ "a@mkt": true }));
    restoreForgottenEnabledKeys(path, "SNAP2");

    expect(isHarnessTapEnabledKey(path, "a@mkt")).toBe(true);
  });

  it("does not give back a key the revert did not restore", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    writeTextFile(path, settingsJson({ "a@mkt": true }));
    recordAddedEnabledKeys(path, undefined, settingsJson({ "a@mkt": true }));
    writeTextFile(path, settingsJson({}));
    forgetMissingEnabledKeys(path, "SNAP3");

    restoreForgottenEnabledKeys(path, "SNAP3");

    expect(isHarnessTapEnabledKey(path, "a@mkt")).toBe(false);
  });

  it("recognizes the Claude settings path only", () => {
    expect(isClaudeSettingsPath(".claude/settings.json")).toBe(true);
    expect(isClaudeSettingsPath(".claude/settings.local.json")).toBe(false);
  });
});

describe("a switch never removes an enabledPlugins key the user wrote", () => {
  const stale = new Map([["gone@mkt", new Set(["/h/.claude/plugins/cache/mkt/gone/1.0.0"])]]);
  const installed = JSON.stringify({ version: 2, plugins: {} });

  it("keeps the key of a plugin whose record is gone when HarnessTap did not add it", () => {
    const settings = settingsJson({ "gone@mkt": true, "other@mkt": true });
    const result = pruneClaudeRegistrations(ctx.homeDir, { installed, settings }, stale);
    expect(result.files.has(CLAUDE_SETTINGS_PATH)).toBe(false);
  });

  it("removes the key HarnessTap added", () => {
    const settings = settingsJson({ "gone@mkt": true, "other@mkt": true });
    recordAddedEnabledKeys(join(ctx.homeDir, CLAUDE_SETTINGS_PATH), settingsJson({ "other@mkt": true }), settings);
    const result = pruneClaudeRegistrations(ctx.homeDir, { installed, settings }, stale);
    const next = JSON.parse(result.files.get(CLAUDE_SETTINGS_PATH) ?? "{}") as {
      enabledPlugins: Record<string, boolean>;
    };
    expect(next.enabledPlugins).toEqual({ "other@mkt": true });
  });

  it("keeps a user false even when the plugin is gone", () => {
    const settings = settingsJson({ "gone@mkt": false });
    recordAddedEnabledKeys(join(ctx.homeDir, CLAUDE_SETTINGS_PATH), settingsJson({}), settingsJson({ "gone@mkt": true }));
    const result = pruneClaudeRegistrations(ctx.homeDir, { installed, settings }, stale);
    expect(result.files.has(CLAUDE_SETTINGS_PATH)).toBe(false);
  });

  it("host config strip drops a key only when the caller says it is HarnessTap's", () => {
    const resource = {
      id: "r",
      type: "plugin",
      name: "gone",
      description: "",
      content: "",
      metadata: {},
      source: "manual",
      namespace: "mkt",
      origin_kind: "manual",
      origin_ref: "gone@mkt",
      content_hash: "",
      created_at: "",
      updated_at: "",
    } as Resource;
    const live = settingsJson({ "gone@mkt": true });
    const kept = tryEditAggregateContent(live, resource, () => false);
    expect(kept.ok).toBe(false);
    const dropped = tryEditAggregateContent(live, resource, () => true);
    expect(dropped.ok).toBe(true);
    if (dropped.ok) expect(dropped.content).not.toContain("gone@mkt");
  });

  it("reads the record file the module wrote", () => {
    const path = join(ctx.homeDir, CLAUDE_SETTINGS_PATH);
    recordAddedEnabledKeys(path, undefined, settingsJson({ "a@mkt": true }));
    const raw = readFileSync(join(getHarnesstapDir(), "cache", "claude-enabled-plugins.json"), "utf8");
    expect(JSON.parse(raw).files[path]).toEqual(["a@mkt"]);
  });
});
