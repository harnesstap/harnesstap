import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { parseDeckToml } from "../../src/services/transport/deck.ts";

describe("CLI environment", () => {
  it("supports create/list/show/delete plus var and secret mutation commands", async () => {
    const context = await createTestContext("cli-environment-crud");
    try {
      await runCli(["init"]);

      const created = await runCli(["environment", "create", "staging", "--format", "json"]);
      expect(JSON.parse(created.stdout)).toEqual(
        expect.objectContaining({
          name: "staging",
        }),
      );

      const listed = await runCli(["environment", "list", "--format", "json"]);
      expect(JSON.parse(listed.stdout)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            environment: expect.objectContaining({ name: "staging" }),
          }),
        ]),
      );

      const afterSet = await runCli([
        "environment",
        "set",
        "staging",
        "--var",
        "PD_REGION=eu",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterSet.stdout)).toEqual(
        expect.objectContaining({
          values: expect.objectContaining({
            env_vars: expect.objectContaining({ PD_REGION: "eu" }),
          }),
        }),
      );

      const afterSecretSet = await runCli([
        "environment",
        "secret",
        "set",
        "staging",
        "PD_TOKEN",
        "--provider",
        "env",
        "--ref",
        "PD_TOKEN",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterSecretSet.stdout)).toEqual(
        expect.objectContaining({
          secret_refs: expect.objectContaining({
            PD_TOKEN: { provider: "env", ref: "PD_TOKEN" },
          }),
        }),
      );

      const shown = await runCli(["environment", "show", "staging", "--format", "json"]);
      expect(JSON.parse(shown.stdout)).toEqual(
        expect.objectContaining({
          environment: expect.objectContaining({ name: "staging" }),
          values: expect.objectContaining({
            env_vars: expect.objectContaining({ PD_REGION: "eu" }),
          }),
          secret_refs: expect.objectContaining({
            PD_TOKEN: { provider: "env", ref: "PD_TOKEN" },
          }),
        }),
      );

      const afterUnset = await runCli([
        "environment",
        "unset",
        "staging",
        "--var",
        "PD_REGION",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterUnset.stdout)).toEqual(
        expect.objectContaining({
          values: expect.objectContaining({
            env_vars: {},
          }),
        }),
      );

      const afterSecretUnset = await runCli([
        "environment",
        "secret",
        "unset",
        "staging",
        "PD_TOKEN",
        "--format",
        "json",
      ]);
      expect(JSON.parse(afterSecretUnset.stdout)).toEqual(
        expect.objectContaining({
          secret_refs: {},
        }),
      );

      const deleted = await runCli(["environment", "delete", "staging", "--format", "json"]);
      expect(JSON.parse(deleted.stdout)).toEqual(
        expect.objectContaining({
          deleted: true,
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("supports layer set-environment/unset-environment and shows default environment", async () => {
    const context = await createTestContext("cli-layer-environment");
    try {
      await runCli(["init"]);

      const pluginModel = await import("../../src/models/layer-model.ts");
      const configuredLayerModel = await import("../../src/models/layer-model.ts");
      const plugin = pluginModel.createLayer({ name: "app-layer" });
      const configuredLayer = configuredLayerModel.createLayerFromSources({
        name: plugin.name,
        version: plugin.version,
        sourceLayerIds: [plugin.id],
      });

      await runCli(["environment", "create", "staging"]);
      await runCli(["layer", "set-environment", configuredLayer.id, "staging"]);

      const layerShowHuman = await runCli(["layer", "show", "app-layer"]);
      expect(layerShowHuman.stdout).toContain("Default environment");
      expect(layerShowHuman.stdout).toContain("staging");

      const layerShowJson = await runCli(["layer", "show", "app-layer", "--format", "json"]);
      expect(JSON.parse(layerShowJson.stdout)).toEqual(
        expect.objectContaining({
          configured_layer: expect.objectContaining({
            default_environment: "staging",
          }),
        }),
      );

      await runCli(["layer", "unset-environment", configuredLayer.id]);
      const afterUnset = await runCli(["layer", "show", "app-layer", "--format", "json"]);
      expect(JSON.parse(afterUnset.stdout)).toEqual(
        expect.objectContaining({
          configured_layer: expect.objectContaining({
            default_environment: null,
          }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("supports capture dry-run and refresh strict failure", async () => {
    const context = await createTestContext("cli-environment-capture");
    try {
      await runCli(["init"]);
      await runCli(["harness", "set", "--main", "claude-code"]);
      await runCli(["environment", "create", "captured"]);

      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".claude", "settings.json"),
        JSON.stringify({ env: { CAPTURE_KEY: "scan-value" } }),
        "utf-8",
      );

      const pluginModel = await import("../../src/models/layer-model.ts");
      const configuredLayerModel = await import("../../src/models/layer-model.ts");
      const plugin = pluginModel.createLayer({
        name: "capture-layer-plugin",
        needs: ["CAPTURE_KEY", "MISSING_KEY"],
      });
      const configuredLayer = configuredLayerModel.createLayerFromSources({
        name: "capture-layer",
        sourceLayerIds: [plugin.id],
      });

      const captureResult = await runCli([
        "environment",
        "capture",
        "captured",
        "--project",
        context.projectDir,
        "--layers",
        configuredLayer.id,
        "--dry-run",
        "--format",
        "json",
      ]);
      expect(JSON.parse(captureResult.stdout)).toEqual(
        expect.objectContaining({
          persisted: false,
          strict_failed: false,
          values: expect.objectContaining({ CAPTURE_KEY: "scan-value" }),
        }),
      );

      const refreshStrict = await runCli([
        "environment",
        "refresh",
        "captured",
        "--project",
        context.projectDir,
        "--layers",
        configuredLayer.id,
        "--strict",
        "--format",
        "json",
      ]);
      expect(refreshStrict.exitCode).toBe(1);
      expect(JSON.parse(refreshStrict.stdout)).toEqual(
        expect.objectContaining({
          strict_failed: true,
          persisted: false,
          missing_keys: expect.arrayContaining([
            expect.objectContaining({ key: "MISSING_KEY", mode: "strict" }),
          ]),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("supports use/active/resolve and surfaces environment cascade in project status", async () => {
    const context = await createTestContext("cli-environment-cascade");
    try {
      await runCli(["init"]);

      const projectModel = await import("../../src/models/project.ts");
      const pluginModel = await import("../../src/models/layer-model.ts");
      const configuredLayerModel = await import("../../src/models/layer-model.ts");
      const deckModel = await import("../../src/models/deck.ts");

      const project = projectModel.createProject({
        git_origin: "git@github.com:acme/cascade.git",
        name: "acme/cascade",
        local_path: context.projectDir,
      });
      const plugin = pluginModel.createLayer({ name: "cascade-layer" });
      const configuredLayer = configuredLayerModel.createLayerFromSources({
        name: plugin.name,
        version: plugin.version,
        sourceLayerIds: [plugin.id],
      });
      projectModel.applyConfiguredLayerToProject({
        project_id: project.id,
        configured_layer_id: configuredLayer.id,
        platforms: ["claude-code"],
      });
      deckModel.createDeck({
        name: "project-deck",
        rootPath: context.projectDir,
      });

      await runCli(["environment", "create", "default-env"]);
      await runCli(["environment", "set", "default-env", "--var", "PD_REGION=layer"]);
      await runCli(["environment", "create", "deck-env"]);
      await runCli(["environment", "set", "deck-env", "--var", "PD_REGION=deck"]);
      await runCli(["layer", "set-environment", configuredLayer.id, "default-env"]);

      const useResult = await runCli([
        "environment",
        "use",
        "deck-env",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(useResult.stdout)).toEqual(
        expect.objectContaining({
          environment_name: "deck-env",
          updated: true,
        }),
      );

      const active = await runCli([
        "environment",
        "active",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(active.stdout)).toEqual(
        expect.objectContaining({
          resolved: expect.objectContaining({
            vars: expect.objectContaining({ PD_REGION: "deck" }),
          }),
        }),
      );

      const resolved = await runCli([
        "environment",
        "resolve",
        "--project",
        context.projectDir,
        "--layers",
        configuredLayer.id,
        "--format",
        "json",
      ]);
      expect(JSON.parse(resolved.stdout)).toEqual(
        expect.objectContaining({
          layer_defaults: expect.arrayContaining([
            expect.objectContaining({
              vars: expect.objectContaining({ PD_REGION: "layer" }),
            }),
          ]),
          resolved: expect.objectContaining({
            vars: expect.objectContaining({ PD_REGION: "deck" }),
          }),
        }),
      );

      const status = await runCli([
        "status",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(status.stdout)).toEqual(
        expect.objectContaining({
          environment_cascade: expect.objectContaining({
            resolved: expect.objectContaining({
              vars: expect.objectContaining({ PD_REGION: "deck" }),
            }),
          }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("writes deck active environment for untracked project roots", async () => {
    const context = await createTestContext("cli-environment-use-untracked");
    try {
      await runCli(["init"]);
      await runCli(["environment", "create", "deck-env"]);

      const useResult = await runCli([
        "environment",
        "use",
        "deck-env",
        "--project",
        context.projectDir,
        "--format",
        "json",
      ]);
      expect(JSON.parse(useResult.stdout)).toEqual(
        expect.objectContaining({
          environment_name: "deck-env",
          deck_tracked: false,
          updated: true,
        }),
      );

      const deckJson = parseDeckToml(
        readFileSync(join(context.projectDir, ".harnessdeck", "deck.toml"), "utf-8"),
      );
      expect(deckJson.active_environment).toBe("deck-env");
    } finally {
      await context.cleanup();
    }
  });

  it("supports environment export/import roundtrip through CLI", async () => {
    const context = await createTestContext("cli-environment-export-import");
    try {
      await runCli(["init"]);
      await runCli(["environment", "create", "portable"]);
      await runCli(["environment", "set", "portable", "--var", "PD_REGION=eu"]);
      await runCli([
        "environment",
        "secret",
        "set",
        "portable",
        "PD_TOKEN",
        "--provider",
        "env",
        "--ref",
        "PD_TOKEN",
      ]);

      const filePath = join(context.projectDir, "portable-environment.toml");
      const exported = await runCli([
        "environment",
        "export",
        "portable",
        filePath,
        "--format",
        "json",
      ]);
      expect(JSON.parse(exported.stdout)).toEqual(
        expect.objectContaining({
          file: filePath,
          environment: expect.objectContaining({
            name: "portable",
          }),
        }),
      );

      await runCli(["environment", "delete", "portable"]);
      const imported = await runCli(["environment", "import", filePath, "--format", "json"]);
      expect(JSON.parse(imported.stdout)).toEqual(
        expect.objectContaining({
          environment: expect.objectContaining({
            name: "portable",
          }),
          imported_keys: ["PD_REGION"],
          imported_secret_refs: ["PD_TOKEN"],
        }),
      );

      const shown = await runCli(["environment", "show", "portable", "--format", "json"]);
      expect(JSON.parse(shown.stdout)).toEqual(
        expect.objectContaining({
          values: expect.objectContaining({
            env_vars: expect.objectContaining({ PD_REGION: "eu" }),
          }),
          secret_refs: expect.objectContaining({
            PD_TOKEN: { provider: "env", ref: "PD_TOKEN" },
          }),
        }),
      );
    } finally {
      await context.cleanup();
    }
  });
});
