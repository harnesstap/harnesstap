import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { ClaudeCodeSerializer } from "../../src/platforms/claude-code.ts";
import { CodexSerializer } from "../../src/platforms/codex.ts";
import { CursorSerializer } from "../../src/platforms/cursor.ts";
import { generateFiles } from "../../src/services/applier.ts";
import { scanPluginSource } from "../../src/services/plugin-source-import.ts";
import type { Resource } from "../../src/types.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

async function hookResourcesFromFixture(): Promise<Resource[]> {
  const hookInputs = [
    ...(await new ClaudeCodeSerializer().scan(fixture)),
    ...(await new CursorSerializer().scan(fixture)),
    ...(await new CodexSerializer().scan(fixture)),
  ].filter((resource) => resource.type === "hook");

  const byKey = new Map<string, Resource>();
  for (const hook of hookInputs) {
    const meta = hook.metadata as { event?: string; script?: string };
    const key = `${meta.event}:${meta.script}`;
    if (!byKey.has(key)) {
      byKey.set(
        key,
        makeResource({
          ...hook,
          id: `hook-${byKey.size + 1}`,
        }),
      );
    }
  }
  return [...byKey.values()];
}

describe("hook apply", () => {
  it("scans hooks from impeccable-layout fixture for each platform", async () => {
    const claude = await new ClaudeCodeSerializer().scan(fixture);
    const cursor = await new CursorSerializer().scan(fixture);
    const codex = await new CodexSerializer().scan(fixture);

    expect(claude.some((resource) => resource.type === "hook")).toBe(true);
    expect(cursor.some((resource) => resource.type === "hook")).toBe(true);
    expect(codex.some((resource) => resource.type === "hook")).toBe(true);
  });

  it("generateFiles emits hooks for claude-code, cursor, and codex", async () => {
    const context = await createInitializedTestContext("hook-apply");
    try {
      const resources = await hookResourcesFromFixture();
      expect(resources.length).toBeGreaterThan(0);

      const generated = await generateFiles(
        resources,
        ["claude-code", "cursor", "codex"],
        context.projectDir,
      );

      const byPlatform = Object.fromEntries(
        generated.map((result) => [result.platformId, result.files]),
      );

      const claudeSettings = byPlatform["claude-code"]?.find(
        (file) => file.path === ".claude/settings.json",
      );
      expect(claudeSettings?.content).toContain('"PostToolUse"');
      expect(claudeSettings?.content).toContain('"matcher": "Edit|Write"');

      const cursorHooks = byPlatform.cursor?.find(
        (file) => file.path === ".cursor/hooks.json",
      );
      expect(cursorHooks?.content).toContain('"version": 1');
      expect(cursorHooks?.content).toContain("preToolUse");

      const codexHooks = byPlatform.codex?.find(
        (file) => file.path === ".codex/hooks.json",
      );
      expect(codexHooks?.content).toContain('"PostToolUse"');
      expect(codexHooks?.content).not.toContain('"version"');
    } finally {
      await context.cleanup();
    }
  });

  it("generateFiles emits hooks from plugin import resources", async () => {
    const context = await createInitializedTestContext("hook-apply-plugin");
    try {
      const entries = await scanPluginSource(
        join(fixture, ".claude-plugin/marketplace.json"),
      );
      const resources: Resource[] = entries
        .flatMap((entry) => entry.resources)
        .filter((resource) => resource.type === "hook")
        .map((resource, index) =>
          makeResource({
            ...resource,
            id: `plugin-hook-${index + 1}`,
          }),
        );

      expect(resources.length).toBeGreaterThan(0);

      const generated = await generateFiles(
        resources,
        ["claude-code"],
        context.projectDir,
      );
      const settings = generated[0]?.files.find(
        (file) => file.path === ".claude/settings.json",
      );
      expect(settings?.content).toContain("hook.mjs");
      expect(settings?.content).toContain("Edit|Write");
    } finally {
      await context.cleanup();
    }
  });
});
