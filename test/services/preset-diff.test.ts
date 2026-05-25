import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("diffPresets - metadata: version and dependencies", () => {
  it("reports metadata change when preset version differs between two bundles", async () => {
    const context = await createInitializedTestContext("diff-version-change");

    try {
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-version-change");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (version: string) => JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        preset: { name: "test", version, description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      });

      writeTextFile(leftPath, makeBundle("1.0.0"));
      writeTextFile(rightPath, makeBundle("2.0.0"));

      const report = diffPresets(leftPath, rightPath);
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

  it("reports no version change when preset versions are the same", async () => {
    const context = await createInitializedTestContext("diff-version-same");

    try {
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-version-same");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (version: string) => JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        preset: { name: "test", version, description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      });

      writeTextFile(leftPath, makeBundle("1.0.0"));
      writeTextFile(rightPath, makeBundle("1.0.0"));

      const report = diffPresets(leftPath, rightPath);
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
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-change");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          preset: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      writeTextFile(leftPath, makeBundle([{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }]));
      writeTextFile(rightPath, makeBundle([{ dependency_name: "base", version_constraint: "^2.0.0", order: 0 }]));

      const report = diffPresets(leftPath, rightPath);
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
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-same");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          preset: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      const deps = [{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }];
      writeTextFile(leftPath, makeBundle(deps));
      writeTextFile(rightPath, makeBundle(deps));

      const report = diffPresets(leftPath, rightPath);
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
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-order-irrelevant");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          preset: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      // Same deps and constraints but different numeric `order` field — should not trigger a diff
      writeTextFile(leftPath, makeBundle([{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }]));
      writeTextFile(rightPath, makeBundle([{ dependency_name: "base", version_constraint: "^1.0.0", order: 99 }]));

      const report = diffPresets(leftPath, rightPath);
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
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-reorder");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          preset: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      const depsAB = [
        { dependency_name: "alpha", version_constraint: "^1.0.0", order: 0 },
        { dependency_name: "beta", version_constraint: "^1.0.0", order: 1 },
      ];
      const depsBA = [
        { dependency_name: "beta", version_constraint: "^1.0.0", order: 0 },
        { dependency_name: "alpha", version_constraint: "^1.0.0", order: 1 },
      ];
      writeTextFile(leftPath, makeBundle(depsAB));
      writeTextFile(rightPath, makeBundle(depsBA));

      const report = diffPresets(leftPath, rightPath);
      const depsChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "dependencies",
      );
      expect(depsChange).toBeDefined();
      expect(depsChange?.change).toBe("modified");
    } finally {
      await context.cleanup();
    }
  });


  it("reports version change when diffing a DB preset against a bundle with different version", async () => {
    const context = await createInitializedTestContext("diff-db-vs-bundle-version");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const { diffPresets } = await import("../../src/services/preset-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-db-vs-bundle-version");

      presetModel.createPreset({ name: "local-preset", version: "3.0.0" });

      const bundlePath = join(tmpDir, "bundle.harnessdeck.json");
      writeTextFile(bundlePath, JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        preset: { name: "local-preset", version: "1.0.0", description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      }));

      const report = diffPresets("local-preset", bundlePath);
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
});
