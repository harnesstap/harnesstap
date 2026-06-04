import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("exporter deck adapters", () => {
  it("imports bundle v1 single layer as one plugin + implicit configured layer", async () => {
    const context = await createInitializedTestContext("import-bundle-v1-deck");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const bundlePath = join(context.projectDir, "single-layer.json");
      writeTextFile(
        bundlePath,
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          layer: {
            name: "pagerduty",
            version: "1.0.0",
            description: "On-call plugin",
            tags: ["oncall"],
          },
          resources: [
            {
              type: "instruction",
              name: "oncall-guide",
              description: "",
              content: "# On-call",
              metadata: {},
            },
          ],
          plugins: [],
          embedded_plugins: [],
        }),
      );

      const result = exporter.importBundleV1AsDeck(bundlePath);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0]?.name).toBe("pagerduty");
      expect(result.configuredLayers).toHaveLength(1);
      expect(result.configuredLayers[0]?.name).toBe("pagerduty");
      expect(result.deck.name).toBe("pagerduty");
    } finally {
      await context.cleanup();
    }
  });

  it("converts bundle v1 env vars into deck.json environments", async () => {
    const exporter = await import("../../src/services/exporter.ts");

    const deckJson = exporter.bundleV1ToDeckJson({
      $schema: "urn:harnessdeck:bundle:v1",
      version: 1,
      layer: {
        name: "pagerduty",
        version: "1.0.0",
        description: "",
        tags: [],
      },
      resources: [
        {
          type: "env_var",
          name: "pd-region",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "eu" },
        },
      ],
      plugins: [],
      embedded_plugins: [],
    });

    expect(deckJson.$schema).toBe("urn:harnessdeck:deck:v1");
    expect(deckJson.environments).toHaveLength(1);
    expect(deckJson.environments[0]?.values.PD_REGION).toBe("eu");
    expect(deckJson.layers[0]?.environment).toBe("pagerduty-env");
  });

  it("exports and re-imports deck.json losslessly", async () => {
    const exportContext = await createInitializedTestContext("deck-json-export");

    try {
      const pluginModel = await import("../../src/models/plugin-component.ts");
      const environmentModel = await import("../../src/models/environment.ts");
      const configuredLayerModel = await import("../../src/models/configured-layer.ts");
      const deckModel = await import("../../src/models/deck.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const plugin = pluginModel.createPlugin({
        name: "pagerduty",
        version: "1.0.0",
        needs: ["PD_TOKEN"],
      });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "oncall-guide", type: "instruction" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const prod = environmentModel.createEnvironment({ name: "prod" });
      const prodVar = resourceModel.createResource({
        type: "env_var",
        name: "pd-region",
        description: "",
        content: "",
        metadata: { key: "PD_REGION", value: "eu" },
        source: "test",
      });
      environmentModel.addResourceToEnvironment(prod.id, prodVar);
      environmentModel.addSecretRefToEnvironment(
        prod.id,
        "PD_TOKEN",
        "keychain",
        "harnessdeck/pd-token",
      );

      const configuredLayer = configuredLayerModel.createConfiguredLayer({
        name: "backend-oncall",
        version: "1.0.0",
        pluginIds: [plugin.id],
        environmentId: prod.id,
      });
      const deck = deckModel.createDeck({ name: "team-deck" });
      deckModel.addConfiguredLayerToDeck(deck.id, configuredLayer.id);
      deckModel.setDeckActiveEnvironment(deck.id, prod.id);

      const exported = exporter.exportDeckToDeckJson(deck.id);
      const deckPath = join(exportContext.projectDir, "deck.json");
      exporter.writeDeckJson(deckPath, exported);

      const importContext = await createInitializedTestContext("deck-json-import");

      try {
        pluginModel.createPlugin({
          name: "pagerduty",
          version: "1.0.0",
          needs: ["PD_TOKEN"],
        });

        const imported = exporter.importDeckJson(deckPath, {
          rootPath: importContext.projectDir,
        });
        const reExported = exporter.exportDeckToDeckJson(imported.deck.id);

        expect(reExported).toEqual(exported);
        expect(imported.configuredLayers).toHaveLength(1);
        expect(imported.environments).toHaveLength(1);
        expect(imported.deck.active_environment_id).toBe(imported.environments[0]?.id);
      } finally {
        await importContext.cleanup();
      }
    } finally {
      await exportContext.cleanup();
    }
  });

  it("keeps bundle v1 import working via importFromFile adapter", async () => {
    const context = await createInitializedTestContext("bundle-v1-adapter");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const bundlePath = join(context.projectDir, "legacy.json");
      writeFileSync(
        bundlePath,
        JSON.stringify({
          $schema: "urn:harnessdeck:bundle:v1",
          version: 1,
          layer: {
            name: "legacy-plugin",
            version: "2.0.0",
            description: "",
            tags: [],
          },
          resources: [],
          plugins: [],
          embedded_plugins: [],
        }),
      );

      const imported = exporter.importFromFile(bundlePath);
      expect(imported.layer.name).toBe("legacy-plugin");
      expect(imported.layer.version).toBe("2.0.0");
      expect(existsSync(bundlePath)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
