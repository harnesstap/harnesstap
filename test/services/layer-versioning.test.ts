import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import {
  addResourceToLayer,
  createLayer,
  getLayerById,
  getLayerByName,
  getLayerResources,
  listLayers,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addLayerAttachment } from "../../src/services/layer-composition.ts";
import {
  assertLayersCleanForShare,
  cutLayerVersion,
  formatLayerVersionLabel,
  LayerVersionError,
  markLayerDirty,
} from "../../src/services/layer-versioning.ts";

function writeHistoryLimit(context: { homeDir: string }, limit: number): void {
  const harnesstapDir = join(context.homeDir, ".harnesstap");
  mkdirSync(harnesstapDir, { recursive: true });
  writeFileSync(
    join(harnesstapDir, "config.jsonc"),
    JSON.stringify({ layerVersionHistoryLimit: limit }),
  );
}

describe("layer versioning", () => {
  it("marks dirty and star label without changing version string", async () => {
    const context = await createInitializedTestContext("layer-version-dirty-label");
    try {
      const layer = createLayer({ name: "alpha", version: "1.0.0" });
      expect(formatLayerVersionLabel(layer.version, layer.dirty)).toBe("1.0.0");

      markLayerDirty(layer.id);

      const dirty = getLayerById(layer.id);
      expect(dirty?.dirty).toBe(true);
      expect(dirty?.version).toBe("1.0.0");
      expect(formatLayerVersionLabel(dirty!.version, dirty!.dirty)).toBe("1.0.0*");

      markLayerDirty(layer.id);
      expect(getLayerById(layer.id)?.dirty).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("COW: frozen previous version keeps pre-dirty composition", async () => {
    const context = await createInitializedTestContext("layer-version-cow");
    try {
      const layer = createLayer({ name: "cow", version: "1.0.0" });
      const resourceA = createResource(makeResourceInput({ name: "skill-a" }));
      const resourceB = createResource(makeResourceInput({ name: "skill-b" }));
      addResourceToLayer(layer.id, resourceA.id);

      markLayerDirty(layer.id);
      addResourceToLayer(layer.id, resourceB.id);

      const head = cutLayerVersion({ layerId: layer.id, newVersion: "1.1.0" });
      expect(head.version).toBe("1.1.0");
      expect(head.dirty).toBe(false);
      expect(head.frozen_at).toBeUndefined();

      const headResourceIds = getLayerResources(head.id).map((resource) => resource.name);
      expect(headResourceIds).toEqual(["skill-a", "skill-b"]);

      const frozen = getLayerByName("cow", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();
      expect(frozen?.dirty).toBe(false);
      expect(getLayerResources(frozen!.id).map((resource) => resource.name)).toEqual([
        "skill-a",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("COW: addLayerAttachment snapshots before first edit", async () => {
    const context = await createInitializedTestContext("layer-version-cow-attachment");
    try {
      const layer = createLayer({ name: "attach-cow", version: "1.0.0" });
      const resourceA = createResource(makeResourceInput({ name: "skill-a" }));
      const resourceB = createResource(makeResourceInput({ name: "skill-b" }));
      addResourceToLayer(layer.id, resourceA.id);

      await addLayerAttachment({
        layer,
        selector: resourceB.name,
        type: "skill",
      });

      const head = cutLayerVersion({ layerId: layer.id, newVersion: "1.1.0" });
      expect(head.version).toBe("1.1.0");
      expect(head.dirty).toBe(false);

      const headResourceIds = getLayerResources(head.id).map((resource) => resource.name);
      expect(headResourceIds).toEqual(["skill-a", "skill-b"]);

      const frozen = getLayerByName("attach-cow", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();
      expect(getLayerResources(frozen!.id).map((resource) => resource.name)).toEqual([
        "skill-a",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when new version equals current", async () => {
    const context = await createInitializedTestContext("layer-version-same");
    try {
      const layer = createLayer({ name: "same", version: "1.0.0" });
      expect(() =>
        cutLayerVersion({ layerId: layer.id, newVersion: "1.0.0" }),
      ).toThrowError(
        expect.objectContaining<Partial<LayerVersionError>>({ code: "same_version" }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when target version already exists", async () => {
    const context = await createInitializedTestContext("layer-version-exists");
    try {
      const head = createLayer({ name: "dup", version: "1.0.0" });
      createLayer({ name: "dup", version: "2.0.0" });

      expect(() =>
        cutLayerVersion({ layerId: head.id, newVersion: "2.0.0" }),
      ).toThrowError(
        expect.objectContaining<Partial<LayerVersionError>>({ code: "version_exists" }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prunes oldest frozen beyond limit including head in count", async () => {
    const context = await createInitializedTestContext("layer-version-prune");
    try {
      writeHistoryLimit(context, 3);
      const layer = createLayer({ name: "history", version: "1.0.0" });

      cutLayerVersion({ layerId: layer.id, newVersion: "1.1.0" });
      const headAfter11 = getLayerByName("history", "1.1.0");
      cutLayerVersion({ layerId: headAfter11!.id, newVersion: "1.2.0" });
      const headAfter12 = getLayerByName("history", "1.2.0");
      cutLayerVersion({ layerId: headAfter12!.id, newVersion: "1.3.0" });

      const versions = listLayers()
        .filter((entry) => entry.name === "history")
        .map((entry) => entry.version)
        .sort();
      expect(versions).toEqual(["1.1.0", "1.2.0", "1.3.0"]);
      expect(getLayerByName("history", "1.0.0")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("assertLayersCleanForShare throws dirty_layers", async () => {
    const context = await createInitializedTestContext("layer-version-share-dirty");
    try {
      const clean = createLayer({ name: "clean", version: "1.0.0" });
      const dirty = createLayer({ name: "dirty", version: "1.0.0" });
      markLayerDirty(dirty.id);

      expect(() => assertLayersCleanForShare([clean, getLayerById(dirty.id)!])).toThrowError(
        expect.objectContaining<Partial<LayerVersionError>>({
          code: "dirty_layers",
          dirtyLayers: [{ name: "dirty", version: "1.0.0" }],
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects markLayerDirty on frozen layer", async () => {
    const context = await createInitializedTestContext("layer-version-frozen-dirty");
    try {
      const layer = createLayer({ name: "frozen", version: "1.0.0" });
      const head = cutLayerVersion({ layerId: layer.id, newVersion: "1.1.0" });
      const frozen = getLayerByName("frozen", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();

      expect(() => markLayerDirty(frozen!.id)).toThrowError(
        expect.objectContaining<Partial<LayerVersionError>>({ code: "frozen_layer" }),
      );
      expect(getLayerById(head.id)?.dirty).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("createLayer arrives clean", async () => {
    const context = await createInitializedTestContext("layer-version-create-clean");
    try {
      const layer = createLayer({ name: "fresh", version: "1.0.0" });
      expect(layer.dirty).toBe(false);
      expect(getLayerById(layer.id)?.dirty).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
