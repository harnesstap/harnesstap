import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPluginFromSource } from "../../src/services/plugin-from-source.ts";
import { createPlugin } from "../../src/models/plugin-model.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("createPluginFromSource integration", () => {
  it("creates a plugin with skill refs without installing to hub", async () => {
    const context = await createInitializedTestContext("plugin-from-source-create");
    try {
      const result = await createPluginFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["caveman", "tdd"],
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      expect(result.attachedSkills.sort()).toEqual(["caveman", "tdd"]);
      expect(result.installedSkills).toEqual([]);
      expect(result.conflictPolicy).toBe("create");
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(false);

      const { getPluginResources } = await import("../../src/models/plugin-model.ts");
      const attached = getPluginResources(result.plugin.id);
      expect(attached.some((resource) => resource.type === "skill" && resource.name === "caveman")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("fails when plugin exists without on-conflict", async () => {
    const context = await createInitializedTestContext("plugin-from-source-conflict");
    try {
      createPlugin({ name: "dbt-expert", version: "1.0.0" });
      await expect(
        createPluginFromSource({
          name: "dbt-expert",
          version: "1.0.0",
          source: fixture,
          skillNames: ["caveman"],
          homeRoot: context.homeDir,
          harnesstapDir: join(context.homeDir, ".harnesstap"),
        }),
      ).rejects.toThrow(/Plugin already exists/);
    } finally {
      await context.cleanup();
    }
  });

  it("merges new skill refs into an existing plugin", async () => {
    const context = await createInitializedTestContext("plugin-from-source-merge");
    try {
      await createPluginFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["caveman"],
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      const merged = await createPluginFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["tdd"],
        onConflict: "merge",
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      expect(merged.conflictPolicy).toBe("merge");
      expect(merged.attachedSkills).toEqual(["tdd"]);

      const { getPlugin, getPluginResources } = await import("../../src/models/plugin-model.ts");
      const plugin = getPlugin("dbt-expert");
      if (!plugin) throw new Error("Expected dbt-expert plugin");
      const attached = getPluginResources(plugin.id);
      expect(attached.filter((resource) => resource.type === "skill").map((resource) => resource.name).sort()).toEqual(
        ["caveman", "tdd"],
      );
    } finally {
      await context.cleanup();
    }
  });

  it("overwrites plugin attachments from the new import", async () => {
    const context = await createInitializedTestContext("plugin-from-source-overwrite");
    try {
      await createPluginFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["caveman", "tdd"],
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      const replaced = await createPluginFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["triage"],
        onConflict: "overwrite",
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      expect(replaced.conflictPolicy).toBe("overwrite");
      const { getPlugin, getPluginResources } = await import("../../src/models/plugin-model.ts");
      const plugin = getPlugin("dbt-expert");
      if (!plugin) throw new Error("Expected dbt-expert plugin");
      const attached = getPluginResources(plugin.id);
      expect(attached.filter((resource) => resource.type === "skill").map((resource) => resource.name)).toEqual(
        ["triage"],
      );
    } finally {
      await context.cleanup();
    }
  });
});
