import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginById,
  getPluginByName,
  getPluginResources,
  listPlugins,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";
import {
  assertPluginsCleanForShare,
  cutPluginVersion,
  formatPluginVersionLabel,
  listPluginVersionHistory,
  PluginVersionError,
  markPluginDirty,
} from "../../src/services/plugin-versioning.ts";

function writeHistoryLimit(context: { homeDir: string }, limit: number): void {
  const harnesstapDir = join(context.homeDir, ".harnesstap");
  mkdirSync(harnesstapDir, { recursive: true });
  writeFileSync(
    join(harnesstapDir, "config.jsonc"),
    JSON.stringify({ pluginVersionHistoryLimit: limit }),
  );
}

describe("plugin versioning", () => {
  it("marks dirty and star label without changing version string", async () => {
    const context = await createInitializedTestContext("plugin-version-dirty-label");
    try {
      const plugin = createPlugin({ name: "alpha", version: "1.0.0" });
      expect(formatPluginVersionLabel(plugin.version, plugin.dirty)).toBe("1.0.0");

      markPluginDirty(plugin.id);

      const dirty = getPluginById(plugin.id);
      expect(dirty?.dirty).toBe(true);
      expect(dirty?.version).toBe("1.0.0");
      expect(formatPluginVersionLabel(dirty!.version, dirty!.dirty)).toBe("1.0.0*");

      markPluginDirty(plugin.id);
      expect(getPluginById(plugin.id)?.dirty).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("COW: frozen previous version keeps pre-dirty composition", async () => {
    const context = await createInitializedTestContext("plugin-version-cow");
    try {
      const plugin = createPlugin({ name: "cow", version: "1.0.0" });
      const resourceA = createResource(makeResourceInput({ name: "skill-a" }));
      const resourceB = createResource(makeResourceInput({ name: "skill-b" }));
      addResourceToPlugin(plugin.id, resourceA.id);

      markPluginDirty(plugin.id);
      addResourceToPlugin(plugin.id, resourceB.id);

      const head = cutPluginVersion({ pluginId: plugin.id, newVersion: "1.1.0" });
      expect(head.version).toBe("1.1.0");
      expect(head.dirty).toBe(false);
      expect(head.frozen_at).toBeUndefined();

      const headResourceIds = getPluginResources(head.id).map((resource) => resource.name);
      expect(headResourceIds).toEqual(["skill-a", "skill-b"]);

      const frozen = getPluginByName("cow", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();
      expect(frozen?.dirty).toBe(false);
      expect(getPluginResources(frozen!.id).map((resource) => resource.name)).toEqual([
        "skill-a",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("COW: addPluginAttachment snapshots before first edit", async () => {
    const context = await createInitializedTestContext("plugin-version-cow-attachment");
    try {
      const plugin = createPlugin({ name: "attach-cow", version: "1.0.0" });
      const resourceA = createResource(makeResourceInput({ name: "skill-a" }));
      const resourceB = createResource(makeResourceInput({ name: "skill-b" }));
      addResourceToPlugin(plugin.id, resourceA.id);

      await addPluginAttachment({
        plugin,
        selector: resourceB.name,
        type: "skill",
      });

      const head = cutPluginVersion({ pluginId: plugin.id, newVersion: "1.1.0" });
      expect(head.version).toBe("1.1.0");
      expect(head.dirty).toBe(false);

      const headResourceIds = getPluginResources(head.id).map((resource) => resource.name);
      expect(headResourceIds).toEqual(["skill-a", "skill-b"]);

      const frozen = getPluginByName("attach-cow", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();
      expect(getPluginResources(frozen!.id).map((resource) => resource.name)).toEqual([
        "skill-a",
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when new version equals current", async () => {
    const context = await createInitializedTestContext("plugin-version-same");
    try {
      const plugin = createPlugin({ name: "same", version: "1.0.0" });
      expect(() =>
        cutPluginVersion({ pluginId: plugin.id, newVersion: "1.0.0" }),
      ).toThrowError(
        expect.objectContaining<Partial<PluginVersionError>>({ code: "same_version" }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects cut when target version already exists", async () => {
    const context = await createInitializedTestContext("plugin-version-exists");
    try {
      const head = createPlugin({ name: "dup", version: "1.0.0" });
      createPlugin({ name: "dup", version: "2.0.0" });

      expect(() =>
        cutPluginVersion({ pluginId: head.id, newVersion: "2.0.0" }),
      ).toThrowError(
        expect.objectContaining<Partial<PluginVersionError>>({ code: "version_exists" }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prunes oldest frozen beyond limit including head in count", async () => {
    const context = await createInitializedTestContext("plugin-version-prune");
    try {
      writeHistoryLimit(context, 3);
      const plugin = createPlugin({ name: "history", version: "1.0.0" });

      cutPluginVersion({ pluginId: plugin.id, newVersion: "1.1.0" });
      const headAfter11 = getPluginByName("history", "1.1.0");
      cutPluginVersion({ pluginId: headAfter11!.id, newVersion: "1.2.0" });
      const headAfter12 = getPluginByName("history", "1.2.0");
      cutPluginVersion({ pluginId: headAfter12!.id, newVersion: "1.3.0" });

      const versions = listPlugins()
        .filter((entry) => entry.name === "history")
        .map((entry) => entry.version)
        .sort();
      expect(versions).toEqual(["1.1.0", "1.2.0", "1.3.0"]);
      expect(getPluginByName("history", "1.0.0")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("assertPluginsCleanForShare throws dirty_plugins", async () => {
    const context = await createInitializedTestContext("plugin-version-share-dirty");
    try {
      const clean = createPlugin({ name: "clean", version: "1.0.0" });
      const dirty = createPlugin({ name: "dirty", version: "1.0.0" });
      markPluginDirty(dirty.id);

      expect(() => assertPluginsCleanForShare([clean, getPluginById(dirty.id)!])).toThrowError(
        expect.objectContaining<Partial<PluginVersionError>>({
          code: "dirty_plugins",
          dirtyPlugins: [{ name: "dirty", version: "1.0.0" }],
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects markPluginDirty on frozen plugin", async () => {
    const context = await createInitializedTestContext("plugin-version-frozen-dirty");
    try {
      const plugin = createPlugin({ name: "frozen", version: "1.0.0" });
      const head = cutPluginVersion({ pluginId: plugin.id, newVersion: "1.1.0" });
      const frozen = getPluginByName("frozen", "1.0.0");
      expect(frozen?.frozen_at).toBeDefined();

      expect(() => markPluginDirty(frozen!.id)).toThrowError(
        expect.objectContaining<Partial<PluginVersionError>>({ code: "frozen_plugin" }),
      );
      expect(getPluginById(head.id)?.dirty).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("createPlugin arrives clean", async () => {
    const context = await createInitializedTestContext("plugin-version-create-clean");
    try {
      const plugin = createPlugin({ name: "fresh", version: "1.0.0" });
      expect(plugin.dirty).toBe(false);
      expect(getPluginById(plugin.id)?.dirty).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("lists head and frozen versions newest first", async () => {
    const context = await createInitializedTestContext("plugin-version-history-list");
    try {
      const plugin = createPlugin({ name: "hist", version: "1.0.0" });
      cutPluginVersion({ pluginId: plugin.id, newVersion: "1.1.0" });
      const head = getPluginByName("hist", "1.1.0");
      cutPluginVersion({ pluginId: head!.id, newVersion: "1.2.0" });

      const rows = listPluginVersionHistory("hist");
      expect(rows.map((row) => row.version)).toEqual(["1.2.0", "1.1.0", "1.0.0"]);
      expect(rows[0]).toMatchObject({
        version: "1.2.0",
        dirty: false,
        frozen_at: null,
        is_head: true,
      });
      expect(rows[1]?.is_head).toBe(false);
      expect(rows[1]?.frozen_at).toBeTruthy();
      expect(rows[2]?.version).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("listPluginVersionHistory returns empty for an unknown name", async () => {
    const context = await createInitializedTestContext("plugin-version-history-missing");
    try {
      expect(listPluginVersionHistory("missing")).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
