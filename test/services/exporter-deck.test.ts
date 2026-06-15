import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { listDeckLayers } from "../../src/models/deck.ts";
import { getLayerById } from "../../src/models/layer-model.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  makeSingleLayerExport,
  writeDeckToml,
  writeLayerExportToml,
} from "../helpers/transport-fixtures.ts";
import { makeResourceInput } from "../helpers/resources.ts";

const minimalDeckFixturePath = join(
  import.meta.dir,
  "../fixtures/decks/minimal-deck.toml",
);
const selectorOnlyDeckFixturePath = join(
  import.meta.dir,
  "../fixtures/decks/selector-only-deck.toml",
);

describe("exporter deck adapters", () => {
  it("imports layer v1 single layer as one plugin + implicit configured layer", async () => {
    const context = await createInitializedTestContext("import-bundle-v1-deck");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const bundlePath = join(context.projectDir, "single-layer.harnessdeck.toml");
      writeLayerExportToml(
        bundlePath,
        makeSingleLayerExport({
          name: "pagerduty",
          version: "1.0.0",
          description: "On-call plugin",
          tags: ["oncall"],
          resources: [
            {
              type: "instruction",
              name: "oncall-guide",
              description: "",
              content: "# On-call",
              metadata: {},
              namespace: "",
              origin_kind: "manual",
              origin_ref: "",
              content_hash: "",
              content_blob_ref: "",
            },
          ],
        }),
      );

      const result = exporter.importLayerExportAsDeck(bundlePath);

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins[0]?.name).toBe("pagerduty");
      expect(result.configuredLayers).toHaveLength(1);
      expect(result.configuredLayers[0]?.name).toBe("pagerduty");
      expect(result.deck.name).toBe("pagerduty");
    } finally {
      await context.cleanup();
    }
  });

  it("converts layer v1 env vars into deck.toml environments", async () => {
    const exporter = await import("../../src/services/exporter.ts");

    const deckJson = exporter.layerExportToDeckJson({
      $schema: "urn:harnessdeck:layer:v1",
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
          namespace: "",
          origin_kind: "manual",
          origin_ref: "",
          content_hash: "",
          content_blob_ref: "",
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

  it("exports and re-imports deck.toml losslessly", async () => {
    const exportContext = await createInitializedTestContext("deck-toml-export");

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
        namespace: "",
        origin_kind: "manual",
        origin_ref: "",
        content_hash: "",
        content_blob_ref: "",
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
      const deckPath = join(exportContext.projectDir, "deck.toml");
      exporter.writeDeckToml(deckPath, exported);

      const importContext = await createInitializedTestContext("deck-toml-import");

      try {
        pluginModel.createPlugin({
          name: "backend-oncall",
          version: "1.0.0",
          needs: ["PD_TOKEN"],
        });

        const imported = exporter.importDeckToml(deckPath, {
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

  it("exports deck layers without plugins[] by default (selector-only)", async () => {
    const context = await createInitializedTestContext("deck-toml-selector-export");

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
      });
      const resource = resourceModel.createResource(
        makeResourceInput({ name: "oncall-guide", type: "instruction" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const prod = environmentModel.createEnvironment({ name: "prod" });
      const configuredLayer = configuredLayerModel.createConfiguredLayer({
        name: "backend-oncall",
        version: "1.0.0",
        pluginIds: [plugin.id],
        environmentId: prod.id,
      });
      const deck = deckModel.createDeck({ name: "team-deck" });
      deckModel.addConfiguredLayerToDeck(deck.id, configuredLayer.id);

      const deckJson = exporter.exportDeckToDeckJson(deck.id);
      expect(deckJson.layers[0]).toMatchObject({
        name: "backend-oncall",
        version: "1.0.0",
        environment: "prod",
      });
      expect(deckJson.layers[0]).not.toHaveProperty("plugins");
    } finally {
      await context.cleanup();
    }
  });

  it("exports legacy plugins[] when selectorOnly is false", async () => {
    const context = await createInitializedTestContext("deck-toml-legacy-export");

    try {
      const pluginModel = await import("../../src/models/plugin-component.ts");
      const configuredLayerModel = await import("../../src/models/configured-layer.ts");
      const deckModel = await import("../../src/models/deck.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const plugin = pluginModel.createPlugin({
        name: "pagerduty",
        version: "1.0.0",
      });
      const configuredLayer = configuredLayerModel.createConfiguredLayer({
        name: "backend-oncall",
        version: "1.0.0",
        pluginIds: [plugin.id],
      });
      const deck = deckModel.createDeck({ name: "team-deck" });
      deckModel.addConfiguredLayerToDeck(deck.id, configuredLayer.id);

      const deckJson = exporter.exportDeckToDeckJson(deck.id, {
        selectorOnly: false,
      });
      expect(deckJson.layers[0]?.plugins).toEqual([
        { name: "backend-oncall", version: "1.0.0" },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("imports deck.toml with legacy plugins[] arrays", async () => {
    const context = await createInitializedTestContext("deck-toml-legacy-import");

    try {
      const pluginModel = await import("../../src/models/plugin-component.ts");
      const exporter = await import("../../src/services/exporter.ts");

      pluginModel.createPlugin({
        name: "pagerduty",
        version: "1.0.0",
      });

      const imported = exporter.importDeckToml(minimalDeckFixturePath, {
        rootPath: context.projectDir,
      });
      const [deckLayer] = listDeckLayers(imported.deck.id);
      expect(getLayerById(deckLayer?.layer_id ?? "")?.name).toBe("backend-oncall");
    } finally {
      await context.cleanup();
    }
  });

  it("imports selector-only deck.toml without plugins[]", async () => {
    const context = await createInitializedTestContext("deck-toml-selector-import");

    try {
      const pluginModel = await import("../../src/models/plugin-component.ts");
      const configuredLayerModel = await import("../../src/models/configured-layer.ts");
      const exporter = await import("../../src/services/exporter.ts");

      const plugin = pluginModel.createPlugin({
        name: "pagerduty",
        version: "1.0.0",
      });
      configuredLayerModel.createConfiguredLayer({
        name: "backend-oncall",
        version: "1.0.0",
        pluginIds: [plugin.id],
      });

      const imported = exporter.importDeckToml(selectorOnlyDeckFixturePath, {
        rootPath: context.projectDir,
      });
      const [deckLayer] = listDeckLayers(imported.deck.id);
      const layer = getLayerById(deckLayer?.layer_id ?? "");
      expect(layer?.name).toBe("backend-oncall");
      expect(layer?.version).toBe("1.0.0");
      expect(layer?.default_environment_id).toBeDefined();
      expect(imported.environments).toHaveLength(1);
      expect(imported.environments[0]?.name).toBe("prod");
    } finally {
      await context.cleanup();
    }
  });

  it("imports selector-only deck.toml with org and catalog", async () => {
    const context = await createInitializedTestContext("deck-toml-published-import");

    try {
      const layerModel = await import("../../src/models/layer-model.ts");
      const exporter = await import("../../src/services/exporter.ts");

      layerModel.createLayer({
        name: "backend-oncall",
        version: "1.0.0",
        org_slug: "acme",
        catalog_slug: "platform",
      });

      const fixturePath = join(context.projectDir, "published-deck.toml");
      writeDeckToml(fixturePath, {
        $schema: "urn:harnessdeck:deck:v1",
        version: 1,
        name: "published-deck",
        layers: [
          {
            name: "backend-oncall",
            version: "1.0.0",
            org: "acme",
            catalog: "platform",
          },
        ],
        environments: [],
      });

      const imported = exporter.importDeckToml(fixturePath, {
        rootPath: context.projectDir,
      });
      const [deckLayer] = listDeckLayers(imported.deck.id);
      const layer = getLayerById(deckLayer?.layer_id ?? "");
      expect(layer?.org_slug).toBe("acme");
      expect(layer?.catalog_slug).toBe("platform");
    } finally {
      await context.cleanup();
    }
  });

  it("keeps layer v1 import working via importFromFile adapter", async () => {
    const context = await createInitializedTestContext("bundle-v1-adapter");

    try {
      const exporter = await import("../../src/services/exporter.ts");
      const bundlePath = join(context.projectDir, "legacy.harnessdeck.toml");
      writeLayerExportToml(
        bundlePath,
        makeSingleLayerExport({
          name: "legacy-plugin",
          version: "2.0.0",
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
