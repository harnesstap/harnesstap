import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { generateFiles } from "../../src/services/applier.ts";
import { scanPluginSource } from "../../src/services/plugin-source-import.ts";
import type { Resource } from "../../src/types.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

describe("impeccable-layout integration", () => {
  it("persistMergedProjectScan does not throw on repo root", async () => {
    const context = await createInitializedTestContext("impeccable-layout-scan");
    try {
      const scanner = await import("../../src/services/scanner.ts");
      const merged = await scanner.persistMergedProjectScan(fixture, undefined, {
        originRef: fixture,
      });
      expect(
        merged.resources.some((r) => r.type === "skill" && r.name === "impeccable"),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("generateFiles emits skill auxiliary files when skillSourceRoot is set", async () => {
    const context = await createInitializedTestContext("impeccable-layout-apply");
    try {
      const entries = await scanPluginSource(fixture);
      const skillInput = entries[0]?.resources.find((r) => r.type === "skill");
      expect(skillInput).toBeDefined();

      const resources: Resource[] = [
        makeResource({
          ...skillInput!,
          id: "impeccable-skill",
        }),
      ];

      const generated = await generateFiles(
        resources,
        ["claude-code"],
        context.projectDir,
        {
          skillSourceRoot: fixture,
        },
      );
      const paths = generated.flatMap((g) => g.files).map((f) => f.path);
      expect(paths).toContain(".claude/skills/impeccable/scripts/context.mjs");
    } finally {
      await context.cleanup();
    }
  });

  it("generateFiles emits hook settings from scanned impeccable-layout resources", async () => {
    const context = await createInitializedTestContext("impeccable-layout-hooks");
    try {
      const { ClaudeCodeSerializer } = await import("../../src/platforms/claude-code.ts");
      const scanned = await new ClaudeCodeSerializer().scan(fixture);
      const hooks = scanned
        .filter((resource) => resource.type === "hook")
        .map((resource, index) =>
          makeResource({
            ...resource,
            id: `hook-${index + 1}`,
          }),
        );
      expect(hooks.length).toBeGreaterThan(0);

      const generated = await generateFiles(
        hooks,
        ["claude-code"],
        context.projectDir,
      );
      const settings = generated[0]?.files.find(
        (file) => file.path === ".claude/settings.json",
      );
      expect(settings?.content).toContain("PostToolUse");
      expect(settings?.content).toContain("Edit|Write");
    } finally {
      await context.cleanup();
    }
  });

  it("generateFiles emits skill sub-commands from command-metadata scan", async () => {
    const context = await createInitializedTestContext("impeccable-layout-commands");
    try {
      const entries = await scanPluginSource(fixture);
      const commands = entries[0]?.resources
        .filter((resource) => resource.type === "command")
        .map((resource, index) =>
          makeResource({
            ...resource,
            id: `command-${index + 1}`,
          }),
        );
      expect(commands?.some((command) => command.name === "impeccable:polish")).toBe(
        true,
      );

      const generated = await generateFiles(
        commands ?? [],
        ["claude-code"],
        context.projectDir,
      );
      const paths = generated.flatMap((result) => result.files).map((file) => file.path);
      expect(paths).toContain(".claude/commands/impeccable:polish.md");
    } finally {
      await context.cleanup();
    }
  });
});
