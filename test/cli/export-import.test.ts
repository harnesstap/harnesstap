import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { writeTextFile } from "../helpers/fs.ts";
import {
  makeMultiPluginExport,
  parseTestPluginToml,
  writePluginExportToml,
} from "../helpers/transport-fixtures.ts";
import { initGitRepo } from "../helpers/git.ts";

describe("CLI export and import", () => {
  it("exports and imports a plugin bundle across isolated homes", async () => {
    const exportContext = await createTestContext("cli-export");

    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");

      const plugin = pluginModel.createPlugin({ name: "bundle-plugin" });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "shared", content: "# Shared" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const bundlePath = `${exportContext.projectDir}/bundle.harnesstap.toml`;
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--plugin",
        "bundle-plugin",
      ]);

      expect(exportResult.stdout).toContain("Exported plugin");
      expect(exportResult.stdout).toContain(bundlePath);
      expect(existsSync(bundlePath)).toBe(true);

      const raw = parseTestPluginToml(readFileSync(bundlePath, "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.$schema).toBe("urn:harnesstap:layer:v1");
      expect(raw.plugins[0]?.plugin_pins ?? []).toEqual([]);
      expect(raw.embedded_plugins ?? []).toEqual([]);

      const importContext = await createTestContext("cli-import");

      try {
        await runCli(["init"]);
        const importResult = await runCli(["migrate", "import", bundlePath]);
        const importedPluginModel = await import("../../src/models/plugin-model.ts");

        expect(importResult.stdout).toContain("Imported plugin");
        expect(importedPluginModel.getPlugin("bundle-plugin")).toBeDefined();
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("plugin export --embed-plugins inlines a resolvable Claude marketplace plugin", async () => {
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

      const pluginModel = await import("../../src/models/plugin-model.ts");
      const pluginPins = await import("../../src/services/plugin-composition.ts");

      const plugin = pluginModel.createPlugin({ name: "embed-flag" });
      pluginPins.attachPluginPinToPlugin(plugin.id, "fmt-cli@acme-marketplace", "2.x");
      const cut = await runCli(["plugin", "cut", "embed-flag", "--version", "1.1.0"]);
      expect(cut.exitCode ?? 0).toBe(0);

      const bundlePath = join(context.projectDir, "embedded-cli.harnesstap.toml");
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--plugin",
        "embed-flag",
        "--embed-plugins",
      ]);

      expect(exportResult.stderr).not.toContain("ENOENT");
      const parsed = parseTestPluginToml(readFileSync(bundlePath, "utf-8"));
      expect(parsed.version).toBe(1);
      expect(parsed.$schema).toBe("urn:harnesstap:layer:v1");
      expect(parsed.embedded_plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: "fmt-cli@acme-marketplace" }),
        ]),
      );
      expect(parsed.plugins[0]?.plugin_pins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: "fmt-cli@acme-marketplace" }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("exports a plugin bundle to a .harnesstap.toml path", async () => {
    const context = await createTestContext("cli-export-toml");

    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "toml-export" });

      const bundlePath = join(context.projectDir, "bundle.harnesstap.toml");
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--plugin",
        "toml-export",
      ]);

      expect(exportResult.stdout).toContain("Exported plugin");
      expect(existsSync(bundlePath)).toBe(true);
      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw.startsWith("# HarnessTap plugin export\n")).toBe(true);
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

[[plugins]]
name = "commented-import"
description = "Imported from TOML"
tags = ["commented"]
version = "1.0.0"
plugins = []
`,
      );

      const importResult = await runCli(["migrate", "import", bundlePath]);
      const pluginModel = await import("../../src/models/plugin-model.ts");

      expect(importResult.stdout).toContain("Imported plugin");
      expect(pluginModel.getPlugin("commented-import")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("exports multiple plugins into a multi-plugin bundle from the CLI", async () => {
    const context = await createTestContext("cli-export-multi-plugin");

    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "alpha" });
      pluginModel.createPlugin({ name: "beta" });

      const bundlePath = join(context.projectDir, "multi-export.harnesstap.toml");
      const exportResult = await runCli([
        "migrate",
        "export",
        bundlePath,
        "--plugin",
        "alpha,beta",
      ]);

      expect(exportResult.stdout).toContain("Exported plugin");
      const raw = readFileSync(bundlePath, "utf-8");
      expect(raw).toContain("[[plugins]]");

      const parsed = await import("../../src/services/plugin-export.ts");
      const bundle = parsed.inspectPluginExportFile(bundlePath);
      expect(bundle.plugins.map((plugin) => plugin.name)).toEqual(["alpha", "beta"]);
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

  it("applies every plugin from a multi-plugin bundle path in declaration order", async () => {
    const context = await createTestContext("cli-apply-multi-bundle");

    try {
      await runCli(["init"]);
      initGitRepo(context.projectDir, "git@github.com:acme/multi-bundle-apply.git");

      const bundlePath = join(context.projectDir, "apply-bundle.harnesstap.toml");
      writePluginExportToml(
        bundlePath,
        makeMultiPluginExport([
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
        "apply",
        bundlePath,
        "--project",
        context.projectDir,
        "--harness",
        "codex",
      ]);

      expect(applyResult.exitCode).toBeUndefined();
      expect(readFileSync(join(context.projectDir, "AGENTS.md"), "utf-8")).toBe("# Beta");

      const pluginModel = await import("../../src/models/plugin-model.ts");
      expect(pluginModel.getPlugin("alpha-imported")).toBeDefined();
      expect(pluginModel.getPlugin("beta-imported")).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
