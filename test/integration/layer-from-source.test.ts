import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createLayerFromSource } from "../../src/services/layer-from-source.ts";
import { createLayer } from "../../src/models/layer-model.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("createLayerFromSource integration", () => {
  it("creates a layer with skill refs without installing to hub", async () => {
    const context = await createInitializedTestContext("layer-from-source-create");
    try {
      const result = await createLayerFromSource({
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

      const { getLayerResources } = await import("../../src/models/layer-model.ts");
      const attached = getLayerResources(result.layer.id);
      expect(attached.some((resource) => resource.type === "skill" && resource.name === "caveman")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("fails when layer exists without on-conflict", async () => {
    const context = await createInitializedTestContext("layer-from-source-conflict");
    try {
      createLayer({ name: "dbt-expert", version: "1.0.0" });
      await expect(
        createLayerFromSource({
          name: "dbt-expert",
          version: "1.0.0",
          source: fixture,
          skillNames: ["caveman"],
          homeRoot: context.homeDir,
          harnesstapDir: join(context.homeDir, ".harnesstap"),
        }),
      ).rejects.toThrow(/Layer already exists/);
    } finally {
      await context.cleanup();
    }
  });

  it("merges new skill refs into an existing layer", async () => {
    const context = await createInitializedTestContext("layer-from-source-merge");
    try {
      await createLayerFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["caveman"],
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      const merged = await createLayerFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["tdd"],
        onConflict: "merge",
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      expect(merged.conflictPolicy).toBe("merge");
      expect(merged.attachedSkills).toEqual(["tdd"]);

      const { getLayer, getLayerResources } = await import("../../src/models/layer-model.ts");
      const layer = getLayer("dbt-expert");
      if (!layer) throw new Error("Expected dbt-expert layer");
      const attached = getLayerResources(layer.id);
      expect(attached.filter((resource) => resource.type === "skill").map((resource) => resource.name).sort()).toEqual(
        ["caveman", "tdd"],
      );
    } finally {
      await context.cleanup();
    }
  });

  it("overwrites layer attachments from the new import", async () => {
    const context = await createInitializedTestContext("layer-from-source-overwrite");
    try {
      await createLayerFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["caveman", "tdd"],
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      const replaced = await createLayerFromSource({
        name: "dbt-expert",
        source: fixture,
        skillNames: ["triage"],
        onConflict: "overwrite",
        homeRoot: context.homeDir,
        harnesstapDir: join(context.homeDir, ".harnesstap"),
      });

      expect(replaced.conflictPolicy).toBe("overwrite");
      const { getLayer, getLayerResources } = await import("../../src/models/layer-model.ts");
      const layer = getLayer("dbt-expert");
      if (!layer) throw new Error("Expected dbt-expert layer");
      const attached = getLayerResources(layer.id);
      expect(attached.filter((resource) => resource.type === "skill").map((resource) => resource.name)).toEqual(
        ["triage"],
      );
    } finally {
      await context.cleanup();
    }
  });
});
