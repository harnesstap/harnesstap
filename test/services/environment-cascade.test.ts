import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createEnvironment, addResourceToEnvironment } from "../../src/models/environment.ts";
import { createLayerFromSources } from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  buildEnvironmentCascadeInput,
  loadHomeEnvironmentFragment,
  mergeResolvedEnvironmentIntoResources,
  resolveEnvironmentCascade,
  resolveEnvironmentCascadeForApply,
} from "../../src/services/environment-cascade.ts";

describe("environment cascade", () => {
  it("last wins: home < layer default", () => {
    const resolved = resolveEnvironmentCascade({
      home: { vars: { PD_REGION: "us" }, secretRefs: {} },
      layerDefaults: [{ vars: { PD_REGION: "eu" }, secretRefs: {} }],
    });
    expect(resolved.vars.PD_REGION).toBe("eu");
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
    });
    expect(resolved.secretRefs.PD_TOKEN).toEqual({
      provider: "keychain",
      ref: "layer-token",
    });
  });

  it("loads home fragments from harnessdeck files", async () => {
    const context = await createInitializedTestContext("env-cascade-files");

    try {
      mkdirSync(join(context.homeDir, ".harnesstap", "environments"), {
        recursive: true,
      });
      writeFileSync(
        join(context.homeDir, ".harnesstap", "active-environment.json"),
        JSON.stringify({ name: "personal" }),
        "utf-8",
      );
      writeFileSync(
        join(context.homeDir, ".harnesstap", "environments", "personal.json"),
        JSON.stringify({ values: { PD_REGION: "us" } }),
        "utf-8",
      );

      const home = loadHomeEnvironmentFragment();
      expect(home?.vars.PD_REGION).toBe("us");

      const resolved = resolveEnvironmentCascadeForApply({
        configuredLayerIds: [],
      });
      expect(resolved.vars.PD_REGION).toBe("us");
    } finally {
      await context.cleanup();
    }
  });

  it("prefers layer default environment over home when both are set", async () => {
    const context = await createInitializedTestContext("env-cascade-layer-default");

    try {
      const home = createEnvironment({ name: "home-env" });
      addResourceToEnvironment(
        home.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          namespace: "home",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "home" },
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

      const layer = createLayerFromSources({
        name: "backend",
        sourceLayerIds: [],
        environmentId: prod.id,
      });

      mkdirSync(join(context.homeDir, ".harnesstap"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".harnesstap", "active-environment.json"),
        JSON.stringify({ name: "home-env" }),
        "utf-8",
      );

      const cascadeInput = buildEnvironmentCascadeInput({
        configuredLayerIds: [layer.id],
      });
      const resolved = resolveEnvironmentCascade(cascadeInput);
      expect(resolved.vars.PD_REGION).toBe("prod");
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
      const staging = createEnvironment({ name: "staging" });
      addResourceToEnvironment(
        staging.id,
        createResource({
          type: "env_var",
          name: "PD_TOKEN",
          namespace: "staging",
          description: "",
          content: "",
          metadata: { key: "PD_TOKEN", value: "plain-token" },
          source: "manual",
        }),
      );

      mkdirSync(join(context.homeDir, ".harnesstap"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".harnesstap", "active-environment.json"),
        JSON.stringify({ name: "staging" }),
        "utf-8",
      );

      const resolved = resolveEnvironmentCascadeForApply({
        configuredLayerIds: [],
      });
      expect(resolved.vars.PD_TOKEN).toBe("plain-token");
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
