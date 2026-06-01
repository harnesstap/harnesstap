import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { initGitRepo } from "../helpers/git.ts";

describe("CLI export and import", () => {
  it("exports and imports a layer bundle across isolated homes", async () => {
    const exportContext = await createTestContext("cli-export");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const layer = layerModel.createLayer({ name: "bundle-layer" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", content: "# Shared" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.json`;
      const exportResult = await runCli([
        "layer",
        "export",
        "bundle-layer",
        "--file",
        bundlePath,
      ]);

      expect(exportResult.stdout).toContain("Exported layer");
      expect(exportResult.stdout).toContain(bundlePath);
      expect(existsSync(bundlePath)).toBe(true);

      const raw = JSON.parse(readFileSync(bundlePath, "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.$schema).toBe("urn:harnessdeck:bundle:v1");
      expect(raw.plugins ?? []).toEqual([]);
      expect(raw.embedded_plugins ?? []).toEqual([]);

      const importContext = await createTestContext("cli-import");

      try {
        await runCli(["init"]);
        const importResult = await runCli(["layer", "import", bundlePath]);
        const importedLayerModel = await import("../../src/models/layer.ts");

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

      const layerModel = await import("../../src/models/layer.ts");
      const pluginModel = await import("../../src/models/plugin.ts");

      const layer = layerModel.createLayer({ name: "embed-flag" });
      pluginModel.addPluginToLayer(layer.id, "fmt-cli@acme-marketplace", "2.x");

      const bundlePath = join(context.projectDir, "embedded-cli.json");
      const exportResult = await runCli([
        "layer",
        "export",
        "embed-flag",
        "--embed-plugins",
        "--file",
        bundlePath,
      ]);

      expect(exportResult.stderr).not.toContain("ENOENT");
      expect(JSON.parse(readFileSync(bundlePath, "utf-8"))).toMatchObject({
        version: 1,
        $schema: "urn:harnessdeck:bundle:v1",
        embedded_plugins: expect.arrayContaining([
          expect.objectContaining({ ref: "fmt-cli@acme-marketplace" }),
        ]),
        plugins: [],
      });
    } finally {
      await context.cleanup();
    }
  });

  it("exports a layer bundle to a .jsonc path", async () => {
    const context = await createTestContext("cli-export-jsonc");

    try {
      await runCli(["init"]);

      const layerModel = await import("../../src/models/layer.ts");
      layerModel.createLayer({ name: "jsonc-export" });

      const bundlePath = join(context.projectDir, "bundle.jsonc");
      const exportResult = await runCli([
        "layer",
        "export",
        "jsonc-export",
        "--file",
        bundlePath,
      ]);

      expect(exportResult.stdout).toContain("Exported layer");
      expect(existsSync(bundlePath)).toBe(true);
      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw.startsWith("/*\n")).toBe(true);
      expect(raw).toContain('"$schema": "urn:harnessdeck:bundle:v1"');
    } finally {
      await context.cleanup();
    }
  });

  it("imports a commented bundle file", async () => {
    const context = await createTestContext("cli-import-jsonc");

    try {
      await runCli(["init"]);

      const bundlePath = join(context.projectDir, "commented-bundle.jsonc");
      writeTextFile(
        bundlePath,
        `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "layer": {
    "name": "commented-import",
    "version": "1.0.0",
    "description": "Imported from JSONC",
    "tags": ["commented",],
  },
  // resources stay comment-friendly
  "resources": [],
  "plugins": [],
  "embedded_plugins": [],
}`,
      );

      const importResult = await runCli(["layer", "import", bundlePath]);
      const layerModel = await import("../../src/models/layer.ts");

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

      const layerModel = await import("../../src/models/layer.ts");
      layerModel.createLayer({ name: "alpha" });
      layerModel.createLayer({ name: "beta" });

      const bundlePath = join(context.projectDir, "multi-export.jsonc");
      const exportResult = await runCli([
        "layer",
        "export",
        "alpha,beta",
        "--file",
        bundlePath,
      ]);

      expect(exportResult.stdout).toContain("Exported layer");
      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw).toContain('"layers"');

      const parsed = await import("../../src/services/exporter.ts");
      const bundle = parsed.inspectBundleFile(bundlePath);
      expect(bundle.layers.map((layer) => layer.name)).toEqual(["alpha", "beta"]);
    } finally {
      await context.cleanup();
    }
  });

  it("applies every layer from a multi-layer bundle path in declaration order", async () => {
    const context = await createTestContext("cli-apply-multi-bundle");

    try {
      await runCli(["init"]);
      initGitRepo(context.projectDir, "git@github.com:acme/multi-bundle-apply.git");

      const bundlePath = join(context.projectDir, "apply-bundle.jsonc");
      writeTextFile(
        bundlePath,
        `{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "layers": [
    {
      "name": "alpha-imported",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [
        {
          "type": "instruction",
          "name": "shared",
          "description": "",
          "content": "# Alpha",
          "metadata": {}
        }
      ],
      "plugins": []
    },
    {
      "name": "beta-imported",
      "version": "1.0.0",
      "description": "",
      "tags": [],
      "resources": [
        {
          "type": "instruction",
          "name": "shared",
          "description": "",
          "content": "# Beta",
          "metadata": {}
        }
      ],
      "plugins": []
    }
  ],
  "embedded_plugins": []
}`,
      );

      const applyResult = await runCli([
        "project",
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--platform",
        "codex",
      ]);

      expect(applyResult.exitCode).toBeUndefined();
      expect(readFileSync(join(context.projectDir, "AGENTS.md"), "utf-8")).toBe("# Beta");

      const layerModel = await import("../../src/models/layer.ts");
      expect(layerModel.getLayer("alpha-imported")).toBeDefined();
      expect(layerModel.getLayer("beta-imported")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
