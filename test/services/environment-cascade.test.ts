import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createConfiguredLayer } from "../../src/models/configured-layer.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  buildEnvironmentCascadeInput,
  loadHomeEnvironmentFragment,
  mergeResolvedEnvironmentIntoResources,
  resolveEnvironmentCascade,
  resolveEnvironmentCascadeForApply,
} from "../../src/services/environment-cascade.ts";
import { writeDeckToml } from "../helpers/transport-fixtures.ts";
import { createDeck, setDeckActiveEnvironment } from "../../src/models/deck.ts";

describe("environment cascade", () => {
  it("last wins: home < layer default < deck active", () => {
    const resolved = resolveEnvironmentCascade({
      home: { vars: { PD_REGION: "us" }, secretRefs: {} },
      layerDefaults: [{ vars: { PD_REGION: "eu" }, secretRefs: {} }],
      deckActive: { vars: { PD_REGION: "staging" }, secretRefs: {} },
    });
    expect(resolved.vars.PD_REGION).toBe("staging");
  });

  it("merges secret refs with the same precedence as vars", () => {
    const resolved = resolveEnvironmentCascade({
      home: {
        vars: {},
        secretRefs: { PD_TOKEN: { provider: "env", ref: "HOME_TOKEN" } },
      },
      layerDefaults: [
        {
          vars: {},
          secretRefs: { PD_TOKEN: { provider: "keychain", ref: "layer-token" } },
        },
      ],
      deckActive: {
        vars: {},
        secretRefs: { PD_TOKEN: { provider: "env", ref: "DECK_TOKEN" } },
      },
    });
    expect(resolved.secretRefs.PD_TOKEN).toEqual({
      provider: "env",
      ref: "DECK_TOKEN",
    });
  });

  it("loads home and deck fragments from harnessdeck files", async () => {
    const context = await createInitializedTestContext("env-cascade-files");

    try {
      mkdirSync(join(context.homeDir, ".harnessdeck", "environments"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".harnessdeck", "active-environment.json"),
        JSON.stringify({ name: "personal" }),
        "utf-8",
      );
      writeFileSync(
        join(context.homeDir, ".harnessdeck", "environments", "personal.json"),
        JSON.stringify({ values: { PD_REGION: "us" } }),
        "utf-8",
      );

      mkdirSync(join(context.projectDir, ".harnessdeck"), { recursive: true });
      writeDeckToml(join(context.projectDir, ".harnessdeck", "deck.toml"), {
        $schema: "urn:harnessdeck:deck:v1",
        version: 1,
        name: "repo-deck",
        layers: [],
        environments: [
          { name: "staging", values: { PD_REGION: "staging" } },
        ],
        active_environment: "staging",
      });

      const home = loadHomeEnvironmentFragment();
      expect(home?.vars.PD_REGION).toBe("us");

      const resolved = resolveEnvironmentCascadeForApply({
        configuredLayerIds: [],
        projectRoot: context.projectDir,
      });
      expect(resolved.vars.PD_REGION).toBe("staging");
    } finally {
      await context.cleanup();
    }
  });

  it("prefers deck active environment from DB over repo deck.toml", async () => {
    const context = await createInitializedTestContext("env-cascade-db-deck");

    try {
      const staging = createEnvironment({ name: "staging" });
      addResourceToEnvironment(
        staging.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          namespace: "staging",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "staging" },
          source: "manual",
        }),
      );
      const prod = createEnvironment({ name: "prod" });
      addResourceToEnvironment(
        prod.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          namespace: "prod",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "prod" },
          source: "manual",
        }),
      );

      const layer = createConfiguredLayer({
        name: "backend",
        pluginIds: [],
        environmentId: prod.id,
      });

      const deck = createDeck({
        name: "team-deck",
        rootPath: context.projectDir,
      });
      setDeckActiveEnvironment(deck.id, staging.id);

      mkdirSync(join(context.projectDir, ".harnessdeck"), { recursive: true });
      writeDeckToml(join(context.projectDir, ".harnessdeck", "deck.toml"), {
        $schema: "urn:harnessdeck:deck:v1",
        version: 1,
        name: "repo-deck",
        layers: [],
        environments: [{ name: "prod", values: { PD_REGION: "prod-file" } }],
        active_environment: "prod",
      });

      const cascadeInput = buildEnvironmentCascadeInput({
        configuredLayerIds: [layer.id],
        projectRoot: context.projectDir,
      });
      const resolved = resolveEnvironmentCascade(cascadeInput);
      expect(resolved.vars.PD_REGION).toBe("staging");
    } finally {
      await context.cleanup();
    }
  });

  it("dereferences env secret refs into vars for apply", async () => {
    const context = await createInitializedTestContext("env-cascade-secrets");

    const envKey = "HD_TEST_CASCADE_SECRET";
    const previousValue = process.env[envKey];
    process.env[envKey] = "resolved-token";

    try {
      mkdirSync(join(context.projectDir, ".harnessdeck"), { recursive: true });
      writeDeckToml(join(context.projectDir, ".harnessdeck", "deck.toml"), {
        $schema: "urn:harnessdeck:deck:v1",
        version: 1,
        name: "repo-deck",
        layers: [],
        environments: [
          {
            name: "staging",
            values: { PD_TOKEN: "plain-token" },
            secret_refs: { PD_TOKEN: { provider: "env", ref: envKey } },
          },
        ],
        active_environment: "staging",
      });

      const resolved = resolveEnvironmentCascadeForApply({
        configuredLayerIds: [],
        projectRoot: context.projectDir,
      });
      expect(resolved.vars.PD_TOKEN).toBe("resolved-token");
    } finally {
      if (previousValue === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousValue;
      }
      await context.cleanup();
    }
  });

  it("overrides merged environment resources before serialize", () => {
    const merged = mergeResolvedEnvironmentIntoResources(
      [
        {
          id: "r1",
          type: "env_var",
          name: "PD_REGION",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "layer-default" },
          source: "manual",
          created_at: "now",
          updated_at: "now",
        },
        {
          id: "r2",
          type: "instruction",
          name: "intro",
          description: "",
          content: "# Intro",
          metadata: {},
          source: "manual",
          created_at: "now",
          updated_at: "now",
        },
      ],
      { vars: { PD_REGION: "staging" }, secretRefs: {} },
    );

    expect(merged).toHaveLength(2);
    const envResource = merged.find((resource) => resource.type === "env_var");
    expect((envResource?.metadata as { value: string }).value).toBe("staging");
    expect(merged.some((resource) => resource.type === "instruction")).toBe(true);
  });
});
