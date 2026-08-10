import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  makeMultiPluginExport,
  makeSinglePluginExport,
  writePluginExportToml,
} from "../helpers/transport-fixtures.ts";

describe("diffPlugins - metadata: version and dependencies", () => {
  it("reports metadata change when plugin version differs between two bundles", async () => {
    const context = await createInitializedTestContext("diff-version-change");

    try {
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-version-change");

      const leftPath = join(tmpDir, "left.harnesstap.toml");
      const rightPath = join(tmpDir, "right.harnesstap.toml");

      writePluginExportToml(leftPath, makeSinglePluginExport({ name: "test", version: "1.0.0" }));
      writePluginExportToml(rightPath, makeSinglePluginExport({ name: "test", version: "2.0.0" }));

      const report = diffPlugins(leftPath, rightPath);
      const versionChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "version",
      );
      expect(versionChange).toBeDefined();
      expect(versionChange?.change).toBe("modified");
      expect(versionChange?.left).toBe("1.0.0");
      expect(versionChange?.right).toBe("2.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("reports no version change when plugin versions are the same", async () => {
    const context = await createInitializedTestContext("diff-version-same");

    try {
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-version-same");

      const leftPath = join(tmpDir, "left.harnesstap.toml");
      const rightPath = join(tmpDir, "right.harnesstap.toml");

      writePluginExportToml(leftPath, makeSinglePluginExport({ name: "test", version: "1.0.0" }));
      writePluginExportToml(rightPath, makeSinglePluginExport({ name: "test", version: "1.0.0" }));

      const report = diffPlugins(leftPath, rightPath);
      const versionChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "version",
      );
      expect(versionChange).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("reports metadata change when dependencies differ between two bundles", async () => {
    const context = await createInitializedTestContext("diff-deps-change");

    try {
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-change");

      const leftPath = join(tmpDir, "left.harnesstap.toml");
      const rightPath = join(tmpDir, "right.harnesstap.toml");

      writePluginExportToml(
        leftPath,
        makeSinglePluginExport({
          name: "test",
          dependencies: [{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }],
        }),
      );
      writePluginExportToml(
        rightPath,
        makeSinglePluginExport({
          name: "test",
          dependencies: [{ dependency_name: "base", version_constraint: "^2.0.0", order: 0 }],
        }),
      );

      const report = diffPlugins(leftPath, rightPath);
      const depsChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "dependencies",
      );
      expect(depsChange).toBeDefined();
      expect(depsChange?.change).toBe("modified");
    } finally {
      await context.cleanup();
    }
  });

  it("reports no dependencies change when dependencies are identical", async () => {
    const context = await createInitializedTestContext("diff-deps-same");

    try {
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-same");

      const leftPath = join(tmpDir, "left.harnesstap.toml");
      const rightPath = join(tmpDir, "right.harnesstap.toml");

      const bundle = makeSinglePluginExport({
        name: "test",
        dependencies: [{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }],
      });
      writePluginExportToml(leftPath, bundle);
      writePluginExportToml(rightPath, bundle);

      const report = diffPlugins(leftPath, rightPath);
      const depsChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "dependencies",
      );
      expect(depsChange).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("reports no dependencies change when numeric order values differ but content and position are the same", async () => {
    const context = await createInitializedTestContext("diff-deps-order-irrelevant");

    try {
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-order-irrelevant");

      const leftPath = join(tmpDir, "left.harnesstap.toml");
      const rightPath = join(tmpDir, "right.harnesstap.toml");

      writePluginExportToml(
        leftPath,
        makeSinglePluginExport({
          name: "test",
          dependencies: [{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }],
        }),
      );
      writePluginExportToml(
        rightPath,
        makeSinglePluginExport({
          name: "test",
          dependencies: [{ dependency_name: "base", version_constraint: "^1.0.0", order: 99 }],
        }),
      );

      const report = diffPlugins(leftPath, rightPath);
      const depsChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "dependencies",
      );
      expect(depsChange).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });

  it("reports dependencies change when dependency order (array position) differs", async () => {
    const context = await createInitializedTestContext("diff-deps-reorder");

    try {
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-reorder");

      const leftPath = join(tmpDir, "left.harnesstap.toml");
      const rightPath = join(tmpDir, "right.harnesstap.toml");

      writePluginExportToml(
        leftPath,
        makeSinglePluginExport({
          name: "test",
          dependencies: [
            { dependency_name: "alpha", version_constraint: "^1.0.0", order: 0 },
            { dependency_name: "beta", version_constraint: "^1.0.0", order: 1 },
          ],
        }),
      );
      writePluginExportToml(
        rightPath,
        makeSinglePluginExport({
          name: "test",
          dependencies: [
            { dependency_name: "beta", version_constraint: "^1.0.0", order: 0 },
            { dependency_name: "alpha", version_constraint: "^1.0.0", order: 1 },
          ],
        }),
      );

      const report = diffPlugins(leftPath, rightPath);
      const depsChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "dependencies",
      );
      expect(depsChange).toBeDefined();
      expect(depsChange?.change).toBe("modified");
    } finally {
      await context.cleanup();
    }
  });

  it("reports version change when diffing a DB plugin against a bundle with different version", async () => {
    const context = await createInitializedTestContext("diff-db-vs-bundle-version");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-db-vs-bundle-version");

      pluginModel.createPlugin({ name: "local-plugin", version: "3.0.0" });

      const bundlePath = join(tmpDir, "bundle.harnesstap.toml");
      writePluginExportToml(
        bundlePath,
        makeSinglePluginExport({ name: "local-plugin", version: "1.0.0" }),
      );

      const report = diffPlugins("local-plugin", bundlePath);
      const versionChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "version",
      );
      expect(versionChange).toBeDefined();
      expect(versionChange?.left).toBe("3.0.0");
      expect(versionChange?.right).toBe("1.0.0");
    } finally {
      await context.cleanup();
    }
  });

  it("rejects diffing against a multi-plugin bundle without explicit plugin selection", async () => {
    const context = await createInitializedTestContext("diff-multi-bundle-rejected");

    try {
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const { diffPlugins } = await import("../../src/services/plugin-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-multi-bundle-rejected");

      pluginModel.createPlugin({ name: "local-plugin", version: "1.0.0" });

      const bundlePath = join(tmpDir, "multi.harnesstap.toml");
      writePluginExportToml(
        bundlePath,
        makeMultiPluginExport([
          { name: "first", version: "1.0.0" },
          { name: "second", version: "1.0.0" },
        ]),
      );

      expect(() => diffPlugins(bundlePath, "local-plugin")).toThrow(
        "Multi-plugin exports are not supported by plugin diff",
      );
    } finally {
      await context.cleanup();
    }
  });
});
