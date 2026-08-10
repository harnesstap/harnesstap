import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { writeTextFile } from "../helpers/fs.ts";
import {
  makeMultiLayerExport,
  parseTestLayerToml,
  writeLayerExportToml,
} from "../helpers/transport-fixtures.ts";
import { initGitRepo } from "../helpers/git.ts";

describe("CLI export and import", () => {
  it("exports and imports a layer bundle across isolated homes", async () => {
    const exportContext = await createTestContext("cli-export");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const layer = layerModel.createLayer({ name: "bundle-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", content: "# Shared" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.harnesstap.toml`;
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--layer",
        "bundle-layer",
      ]);

      expect(exportResult.stdout).toContain("Exported layer");
      expect(exportResult.stdout).toContain(bundlePath);
      expect(existsSync(bundlePath)).toBe(true);

      const raw = parseTestLayerToml(readFileSync(bundlePath, "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.$schema).toBe("urn:harnesstap:layer:v1");
      expect(raw.layers[0]?.plugin_pins ?? []).toEqual([]);
      expect(raw.embedded_plugins ?? []).toEqual([]);

      const importContext = await createTestContext("cli-import");

      try {
        await runCli(["init"]);
        const importResult = await runCli(["migrate", "import", bundlePath]);
        const importedLayerModel = await import("../../src/models/plugin-model.ts");

        expect(importResult.stdout).toContain("Imported layer");
        expect(importedLayerModel.getLayer("bundle-layer")).toBeDefined();
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("layer export --embed-plugins inlines a resolvable Claude marketplace plugin", async () => {
    const context = await createTestContext("cli-export-embed");

    try {
      await runCli(["init"]);

      const claudePlug = join(context.homeDir, ".claude", "plugins");
      mkdirSync(claudePlug, { recursive: true });
      const installRel = "cache/acme-marketplace/fmt-cli";
      const plugRoot = join(claudePlug, installRel);
      mkdirSync(join(plugRoot, ".claude-plugin"), { recursive: true });
      writeTextFile(
        join(plugRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ version: "2.2.0" }),
      );
      writeTextFile(
        join(claudePlug, "installed_plugins.json"),
        JSON.stringify({
          plugins: {
            "fmt-cli@acme-marketplace": [
              {
                scope: "user",
                installPath: installRel,
                version: "2.2.0",
              },
            ],
          },
        }),
      );

      const layerModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/layer-composition.ts");

      const layer = layerModel.createLayer({ name: "embed-flag" });
      pluginPins.attachPluginPinToLayer(layer.id, "fmt-cli@acme-marketplace", "2.x");

      const bundlePath = join(context.projectDir, "embedded-cli.harnesstap.toml");
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--layer",
        "embed-flag",
        "--embed-plugins",
      ]);

      expect(exportResult.stderr).not.toContain("ENOENT");
      const parsed = parseTestLayerToml(readFileSync(bundlePath, "utf-8"));
      expect(parsed.version).toBe(1);
      expect(parsed.$schema).toBe("urn:harnesstap:layer:v1");
      expect(parsed.embedded_plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: "fmt-cli@acme-marketplace" }),
        ]),
      );
      expect(parsed.layers[0]?.plugin_pins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: "fmt-cli@acme-marketplace" }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("exports a layer bundle to a .harnesstap.toml path", async () => {
    const context = await createTestContext("cli-export-toml");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/plugin-model.ts");
      layerModel.createLayer({ name: "toml-export" });

      const bundlePath = join(context.projectDir, "bundle.harnesstap.toml");
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--layer",
        "toml-export",
      ]);

      expect(exportResult.stdout).toContain("Exported layer");
      expect(existsSync(bundlePath)).toBe(true);
      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw.startsWith("# HarnessTap layer export\n")).toBe(true);
      expect(raw).toContain('schema = "urn:harnesstap:layer:v1"');
    } finally {
      await context.cleanup();
    }
  });

  it("imports a commented bundle file", async () => {
    const context = await createTestContext("cli-import-toml");

    try {
      await runCli(["init"]);

      const bundlePath = join(context.projectDir, "commented-bundle.harnesstap.toml");
      writeTextFile(
        bundlePath,
        `# commented import
schema = "urn:harnesstap:layer:v1"
version = 1

[[layers]]
name = "commented-import"
description = "Imported from TOML"
tags = ["commented"]
version = "1.0.0"
plugins = []
`,
      );

      const importResult = await runCli(["migrate", "import", bundlePath]);
      const layerModel = await import("../../src/models/plugin-model.ts");

      expect(importResult.stdout).toContain("Imported layer");
      expect(layerModel.getLayer("commented-import")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("exports multiple layers into a multi-layer bundle from the CLI", async () => {
    const context = await createTestContext("cli-export-multi-layer");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/plugin-model.ts");
      layerModel.createLayer({ name: "alpha" });
      layerModel.createLayer({ name: "beta" });

      const bundlePath = join(context.projectDir, "multi-export.harnesstap.toml");
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--layer",
        "alpha,beta",
      ]);

      expect(exportResult.stdout).toContain("Exported layer");
      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw).toContain("[[layers]]");

      const parsed = await import("../../src/services/layer-export.ts");
      const bundle = parsed.inspectLayerExportFile(bundlePath);
      expect(bundle.layers.map((layer) => layer.name)).toEqual(["alpha", "beta"]);
    } finally {
      await context.cleanup();
    }
  });

  it("exports and imports a resource via migrate", async () => {
    const exportContext = await createTestContext("cli-resource-export");
    try {
      await runCli(["init"]);
      const resourceModel = await import("../../src/models/resource.ts");
      resourceModel.createResource(
        makeResourceInput({ name: "portable", content: "# R" }),
      );

      const outPath = `${exportContext.projectDir}/portable.harnesstap.toml`;
      await runCli(["migrate", "export", outPath, "--resource", "skill:portable"]);

      const importContext = await createTestContext("cli-resource-import");
      try {
        await runCli(["init"]);
        await runCli(["migrate", "import", outPath]);
        const importedResourceModel = await import("../../src/models/resource.ts");
        expect(
          importedResourceModel.resolveResource("skill:portable").status,
        ).toBe("found");
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("applies every layer from a multi-layer bundle path in declaration order", async () => {
    const context = await createTestContext("cli-apply-multi-bundle");

    try {
      await runCli(["init"]);
      initGitRepo(context.projectDir, "git@github.com:acme/multi-bundle-apply.git");

      const bundlePath = join(context.projectDir, "apply-bundle.harnesstap.toml");
      writeLayerExportToml(
        bundlePath,
        makeMultiLayerExport([
          {
            name: "alpha-imported",
            resources: [
              {
                type: "instruction",
                name: "shared",
                description: "",
                content: "# Alpha",
                metadata: {},
                namespace: "",
                origin_kind: "manual",
                origin_ref: "",
                content_hash: "",
                content_blob_ref: "",
              },
            ],
          },
          {
            name: "beta-imported",
            resources: [
              {
                type: "instruction",
                name: "shared",
                description: "",
                content: "# Beta",
                metadata: {},
                namespace: "",
                origin_kind: "manual",
                origin_ref: "",
                content_hash: "",
                content_blob_ref: "",
              },
            ],
          },
        ]),
      );

      const applyResult = await runCli([
        "layer", "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
      ]);

      expect(applyResult.exitCode).toBeUndefined();
      expect(readFileSync(join(context.projectDir, "AGENTS.md"), "utf-8")).toBe("# Beta");

      const layerModel = await import("../../src/models/plugin-model.ts");
      expect(layerModel.getLayer("alpha-imported")).toBeDefined();
      expect(layerModel.getLayer("beta-imported")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
