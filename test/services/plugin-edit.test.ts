import { describe, expect, it } from "bun:test";
import {
  createPlugin,
  addResourceToPlugin,
  getPluginById,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { upsertResource } from "../../src/models/resource.ts";
import {
  applyPluginEdit,
  attachmentKey,
  buildPluginEditCandidates,
  computePluginEditDiff,
  sortPluginEditRowsForDisplay,
  validatePluginEditSelection,
  type PluginEditRow,
} from "../../src/services/plugin-edit.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";
import { updateProfileMetadata } from "../../src/services/profile-edit.ts";
import { createTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("plugin-edit", () => {
  it("builds stable attachment keys", () => {
    expect(
      attachmentKey({ type: "skill", name: "auth", namespace: "" } as never),
    ).toBe("skill:auth");
    expect(
      attachmentKey({
        type: "plugin_pin",
        name: "posthog",
        namespace: "cursor-team-kit",
      } as never),
    ).toBe("plugin_pin:posthog@cursor-team-kit");
  });

  it("sorts checked rows before unchecked within a type by updated_at desc", () => {
    const rows: PluginEditRow[] = [
      {
        id: "a",
        type: "skill",
        name: "old-checked",
        checked: true,
        updated_at: "2026-01-01T00:00:00.000Z",
      } as PluginEditRow,
      {
        id: "b",
        type: "skill",
        name: "new-unchecked",
        checked: false,
        updated_at: "2026-01-03T00:00:00.000Z",
      } as PluginEditRow,
      {
        id: "c",
        type: "skill",
        name: "new-checked",
        checked: true,
        updated_at: "2026-01-02T00:00:00.000Z",
      } as PluginEditRow,
    ];

    const sorted = sortPluginEditRowsForDisplay(rows);
    expect(sorted.map((row) => row.id)).toEqual(["c", "a", "b"]);
  });

  it("builds candidates from library and prechecks plugin attachments", async () => {
    const context = await createTestContext("plugin-edit-candidates");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "stack", version: "1.0.0" });
      createPlugin({ name: "baseline", version: "1.0.0" });
      const skill = upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      ).resource;
      addResourceToPlugin(plugin.id, skill.id);

      const rows = buildPluginEditCandidates(plugin);
      const helper = rows.find((row) => row.id === skill.id);
      const baseline = rows.find((row) => row.type === "plugin" && row.name === "baseline");

      expect(helper?.checked).toBe(true);
      expect(baseline).toBeDefined();
      expect(baseline?.checked).toBe(false);
      expect(rows.some((row) => row.name === "stack" && row.type === "plugin")).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("computes added and removed attachment diffs", () => {
    const initial: PluginEditRow[] = [
      {
        type: "skill",
        name: "keep",
        namespace: "",
        checked: true,
      } as PluginEditRow,
      {
        type: "skill",
        name: "drop",
        namespace: "",
        checked: true,
      } as PluginEditRow,
      {
        type: "rule",
        name: "add",
        namespace: "",
        checked: false,
      } as PluginEditRow,
    ];
    const pending: PluginEditRow[] = [
      { ...initial[0], checked: true },
      { ...initial[1], checked: false },
      { ...initial[2], checked: true },
    ];

    const diff = computePluginEditDiff(initial, pending);
    expect(diff.added.map((row) => attachmentKey(row))).toEqual(["rule:add"]);
    expect(diff.removed.map((row) => attachmentKey(row))).toEqual(["skill:drop"]);
  });

  it("applies added and removed material resources", async () => {
    const context = await createTestContext("plugin-edit-apply");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "stack", version: "1.0.0" });
      const keep = upsertResource(
        makeResourceInput({ type: "skill", name: "keep" }),
        { policy: "overwrite" },
      ).resource;
      const drop = upsertResource(
        makeResourceInput({ type: "skill", name: "drop" }),
        { policy: "overwrite" },
      ).resource;
      const add = upsertResource(
        makeResourceInput({ type: "rule", name: "add" }),
        { policy: "overwrite" },
      ).resource;
      addResourceToPlugin(plugin.id, keep.id);
      addResourceToPlugin(plugin.id, drop.id);

      const initial = buildPluginEditCandidates(plugin);
      const pending = initial.map((row) => {
        if (row.id === drop.id) {
          return { ...row, checked: false };
        }
        if (row.id === add.id) {
          return { ...row, checked: true };
        }
        return row;
      });

      const result = await applyPluginEdit({ plugin, initial, pending });
      expect(result.added).toEqual(["rule:add"]);
      expect(result.removed).toEqual(["skill:drop"]);

      const names = getPluginResources(plugin.id).map((resource) => resource.name);
      expect(names).toContain("keep");
      expect(names).toContain("add");
      expect(names).not.toContain("drop");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects self plugin reference", async () => {
    const context = await createTestContext("plugin-edit-self-ref");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "stack", version: "1.0.0" });
    const rows: PluginEditRow[] = [
      {
        id: `plugin-candidate:${plugin.id}`,
        type: "plugin",
        name: "stack",
        namespace: "1.0.0",
        checked: true,
        updated_at: "2026-01-01T00:00:00.000Z",
        display_name: "stack@1.0.0",
      } as PluginEditRow,
    ];
    expect(() => validatePluginEditSelection(plugin, rows)).toThrow(/cannot reference itself/i);
    } finally {
      await context.cleanup();
    }
  });

  it("marks plugin dirty when adding an attachment", async () => {
    const context = await createTestContext("plugin-edit-marks-dirty");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const plugin = createPlugin({ name: "stack", version: "1.0.0" });
      const skill = upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      ).resource;

      expect(getPluginById(plugin.id)?.dirty).toBe(false);

      await addPluginAttachment({
        plugin,
        selector: skill.name,
        type: "skill",
      });

      expect(getPluginById(plugin.id)?.dirty).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("marks profile dirty when metadata is updated", async () => {
    const context = await createTestContext("plugin-edit-profile-metadata-dirty");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const profile = createPlugin({
        name: "work",
        version: "1.0.0",
        tags: ["profile"],
      });

      expect(getPluginById(profile.id)?.dirty).toBe(false);

      updateProfileMetadata(profile.name, { description: "Updated profile" });

      expect(getPluginById(profile.id)?.dirty).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
