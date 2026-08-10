import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addResourceToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  getEnvironmentResources,
  hasEnvironmentReferences,
  listEnvironmentReferences,
  removeEnvironmentEnvVar,
  removeEnvironmentModelConfig,
  removeEnvironmentPermission,
  upsertEnvironmentEnvVar,
  upsertEnvironmentModelConfig,
  upsertEnvironmentPermission,
} from "../../src/models/environment.ts";
import {
  createPluginFromSources,
  setPluginDefaultEnvironment,
} from "../../src/models/plugin-model.ts";

describe("environment model", () => {
  it("stores non-secret env vars on environment", async () => {
    const context = await createInitializedTestContext("environment-resources");

    try {
      const env = createEnvironment({ name: "staging" });
      addResourceToEnvironment(
        env.id,
        createResource({
          type: "env_var",
          name: "PD_REGION",
          description: "",
          content: "",
          metadata: { key: "PD_REGION", value: "eu" },
          source: "manual",
        }),
      );
      expect(getEnvironmentResources(env.id)).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("upserts and removes env vars, model configs, and permissions", async () => {
    const context = await createInitializedTestContext("environment-upsert-remove");

    try {
      const env = createEnvironment({ name: "staging" });

      upsertEnvironmentEnvVar(env.id, "PD_REGION", "us");
      upsertEnvironmentEnvVar(env.id, "PD_REGION", "eu");

      upsertEnvironmentModelConfig(env.id, {
        name: "default",
        model: "gpt-4.1",
      });
      upsertEnvironmentModelConfig(env.id, {
        name: "default",
        model: "gpt-5",
        provider: "openai",
      });

      upsertEnvironmentPermission(env.id, {
        name: "repo-read",
        action: "allow",
        pattern: "github.com/acme/*",
      });
      upsertEnvironmentPermission(env.id, {
        name: "repo-read",
        action: "ask",
        pattern: "github.com/acme/*",
      });

      const resources = getEnvironmentResources(env.id);
      expect(resources.filter((resource) => resource.type === "env_var")).toHaveLength(1);
      expect(resources.filter((resource) => resource.type === "model_config")).toHaveLength(1);
      expect(resources.filter((resource) => resource.type === "permission")).toHaveLength(1);

      expect(removeEnvironmentEnvVar(env.id, "PD_REGION")).toBe(true);
      expect(removeEnvironmentModelConfig(env.id, "default")).toBe(true);
      expect(
        removeEnvironmentPermission(env.id, {
          name: "repo-read",
          action: "ask",
          pattern: "github.com/acme/*",
        }),
      ).toBe(true);
      expect(removeEnvironmentEnvVar(env.id, "PD_REGION")).toBe(false);
      expect(removeEnvironmentModelConfig(env.id, "default")).toBe(false);
      expect(
        removeEnvironmentPermission(env.id, {
          name: "repo-read",
          action: "ask",
          pattern: "github.com/acme/*",
        }),
      ).toBe(false);

      expect(getEnvironmentResources(env.id)).toHaveLength(0);
    } finally {
      await context.cleanup();
    }
  });

  it("tracks configured plugin environment references", async () => {
    const context = await createInitializedTestContext("environment-references");

    try {
      const env = createEnvironment({ name: "prod" });
      const configuredPlugin = createPluginFromSources({
        name: "backend",
        sourcePluginIds: [],
        environmentId: env.id,
      });

      const references = listEnvironmentReferences(env.id);
      expect(references.plugins).toEqual([
        expect.objectContaining({ id: configuredPlugin.id, name: "backend" }),
      ]);
      expect(hasEnvironmentReferences(env.id)).toBe(true);

      setPluginDefaultEnvironment(configuredPlugin.id, null);
      expect(listEnvironmentReferences(env.id)).toEqual({
        plugins: [],
      });
      expect(hasEnvironmentReferences(env.id)).toBe(false);

      const missing = getEnvironmentByName("missing-env");
      expect(missing).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
