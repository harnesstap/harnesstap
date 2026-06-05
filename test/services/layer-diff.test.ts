import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

describe("diffLayers - metadata: version and dependencies", () => {
  it("reports metadata change when layer version differs between two bundles", async () => {
    const context = await createInitializedTestContext("diff-version-change");

    try {
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-version-change");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (version: string) => JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        layer: { name: "test", version, description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      });

      writeTextFile(leftPath, makeBundle("1.0.0"));
      writeTextFile(rightPath, makeBundle("2.0.0"));

      const report = diffLayers(leftPath, rightPath);
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

  it("reports no version change when layer versions are the same", async () => {
    const context = await createInitializedTestContext("diff-version-same");

    try {
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-version-same");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (version: string) => JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        layer: { name: "test", version, description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      });

      writeTextFile(leftPath, makeBundle("1.0.0"));
      writeTextFile(rightPath, makeBundle("1.0.0"));

      const report = diffLayers(leftPath, rightPath);
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
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-change");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          layer: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      writeTextFile(leftPath, makeBundle([{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }]));
      writeTextFile(rightPath, makeBundle([{ dependency_name: "base", version_constraint: "^2.0.0", order: 0 }]));

      const report = diffLayers(leftPath, rightPath);
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
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-same");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          layer: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      const deps = [{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }];
      writeTextFile(leftPath, makeBundle(deps));
      writeTextFile(rightPath, makeBundle(deps));

      const report = diffLayers(leftPath, rightPath);
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
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-order-irrelevant");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          layer: { name: "test", version: "1.0.0", description: "", tags: [] },
          resources: [],
          plugins: [],
          embedded_plugins: [],
          dependencies: deps,
        });

      // Same deps and constraints but different numeric `order` field — should not trigger a diff
      writeTextFile(leftPath, makeBundle([{ dependency_name: "base", version_constraint: "^1.0.0", order: 0 }]));
      writeTextFile(rightPath, makeBundle([{ dependency_name: "base", version_constraint: "^1.0.0", order: 99 }]));

      const report = diffLayers(leftPath, rightPath);
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
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-deps-reorder");

      const leftPath = join(tmpDir, "left.harnessdeck.json");
      const rightPath = join(tmpDir, "right.harnessdeck.json");

      const makeBundle = (deps: Array<{ dependency_name: string; version_constraint: string; order: number }>) =>
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          layer: { name: "test", version: "1.0.0", description: "", tags: [] },
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

      const report = diffLayers(leftPath, rightPath);
      const depsChange = report.changes.find(
        (c) => c.kind === "metadata" && c.key === "dependencies",
      );
      expect(depsChange).toBeDefined();
      expect(depsChange?.change).toBe("modified");
    } finally {
      await context.cleanup();
    }
  });


  it("reports version change when diffing a DB layer against a bundle with different version", async () => {
    const context = await createInitializedTestContext("diff-db-vs-bundle-version");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-db-vs-bundle-version");

      layerModel.createLayer({ name: "local-layer", version: "3.0.0" });

      const bundlePath = join(tmpDir, "bundle.harnessdeck.json");
      writeTextFile(bundlePath, JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        layer: { name: "local-layer", version: "1.0.0", description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      }));

      const report = diffLayers("local-layer", bundlePath);
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

  it("rejects diffing against a multi-layer bundle without explicit layer selection", async () => {
    const context = await createInitializedTestContext("diff-multi-bundle-rejected");

    try {
      const layerModel = await import("../../src/models/layer.ts");
      const { diffLayers } = await import("../../src/services/layer-diff.ts");
      const { createTempDir } = await import("../helpers/fs.ts");
      const tmpDir = createTempDir("diff-multi-bundle-rejected");

      layerModel.createLayer({ name: "local-layer", version: "1.0.0" });

      const bundlePath = join(tmpDir, "multi.harnessdeck.jsonc");
      writeTextFile(
        bundlePath,
        `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "layers": [
    {
      "name": "first",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [],
      "plugins": []
    },
    {
      "name": "second",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [],
      "plugins": []
    }
  ],
  "embedded_plugins": []
}`,
      );

      expect(() => diffLayers(bundlePath, "local-layer")).toThrow(
        "Multi-layer bundles are not supported by layer diff",
      );
    } finally {
      await context.cleanup();
    }
  });
});
