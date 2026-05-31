import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("imported snapshot model", () => {
  it("creates and lists imported snapshots", async () => {
    const context = await createInitializedTestContext("imported-snapshot-model");

    try {
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      const first = importedSnapshotModel.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "Cursor community",
        plugin_name: "quality-tools",
        plugin_version: "1.2.3",
        resource_ids: ["resource-1", "resource-2"],
        metadata: {
          upstream_id: "cursor/quality-tools",
          manifest_version: 3,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const second = importedSnapshotModel.createImportedSnapshot({
        source_kind: "claude-plugin",
        source_label: "Claude local import",
        plugin_name: "reviewer",
        resource_ids: ["resource-3"],
        metadata: {
          repo: "acme/reviewer",
        },
      });

      const snapshots = importedSnapshotModel.listImportedSnapshots();

      expect(first.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(second.plugin_version).toBeUndefined();
      expect(snapshots).toHaveLength(2);
      expect(snapshots[0]).toEqual(second);
      expect(snapshots[1]).toEqual(first);
    } finally {
      await context.cleanup();
    }
  });

  it("records and lists imported snapshot installs", async () => {
    const context = await createInitializedTestContext("imported-snapshot-installs");

    try {
      const importedSnapshotModel = await import(
        "../../src/models/imported-snapshot.ts"
      );

      const snapshot = importedSnapshotModel.createImportedSnapshot({
        source_kind: "marketplace",
        source_label: "Acme Marketplace",
        plugin_name: "formatter",
        plugin_version: "4.5.6",
        resource_ids: ["resource-a"],
        metadata: {
          marketplace: "acme",
        },
      });

      const firstInstall = importedSnapshotModel.recordImportedSnapshotInstall({
        snapshot_id: snapshot.id,
        platform_id: "claude-code",
        files: [".claude/plugins/formatter/manifest.json", ".claude/settings.json"],
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const secondInstall = importedSnapshotModel.recordImportedSnapshotInstall({
        snapshot_id: snapshot.id,
        platform_id: "cursor",
        files: [".cursor/plugins/formatter/plugin.json"],
      });

      const installs = importedSnapshotModel.listImportedSnapshotInstalls(
        snapshot.id,
      );

      expect(installs).toHaveLength(2);
      expect(installs).toEqual([secondInstall, firstInstall]);
    } finally {
      await context.cleanup();
    }
  });
});
