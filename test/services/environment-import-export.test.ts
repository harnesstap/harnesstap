import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  getEnvironmentByName,
  getEnvironmentSecretRefs,
  upsertEnvironmentEnvVar,
} from "../../src/models/environment.ts";
import {
  exportEnvironmentJsonc,
  importEnvironmentJsonc,
} from "../../src/services/environment-import-export.ts";

describe("environment import/export service", () => {
  it("imports JSONC with comments and trailing commas", async () => {
    const context = await createInitializedTestContext("env-import-jsonc");

    try {
      const result = importEnvironmentJsonc(`{
  // environment for local testing
  "name": "local",
  "values": {
    "PD_REGION": "us",
    "PD_SITE": "us1",
  },
  "secret_refs": {
    "PD_TOKEN": { "provider": "env", "ref": "PD_TOKEN" },
  },
}`);

      expect(result.environment.name).toBe("local");
      expect(result.imported_keys).toEqual(["PD_REGION", "PD_SITE"]);
      expect(result.imported_secret_refs).toEqual(["PD_TOKEN"]);

      const environment = getEnvironmentByName("local");
      expect(environment).toBeDefined();
      if (!environment) {
        throw new Error("Expected local environment to exist after import");
      }
      expect(getEnvironmentSecretRefs(environment.id)).toEqual([
        expect.objectContaining({
          key: "PD_TOKEN",
          provider: "env",
          ref: "PD_TOKEN",
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("roundtrips environment values and secret refs via export/import JSONC", async () => {
    const context = await createInitializedTestContext("env-export-roundtrip");

    try {
      const source = createEnvironment({ name: "staging" });
      upsertEnvironmentEnvVar(source.id, "PD_REGION", "eu");
      upsertEnvironmentEnvVar(source.id, "PD_SITE", "eu1");
      addSecretRefToEnvironment(source.id, "PD_TOKEN", "env", "PD_TOKEN");

      const exported = exportEnvironmentJsonc("staging");
      expect(exported.environment).toEqual({
        name: "staging",
        values: {
          PD_REGION: "eu",
          PD_SITE: "eu1",
        },
        secret_refs: {
          PD_TOKEN: {
            provider: "env",
            ref: "PD_TOKEN",
          },
        },
      });
      expect(exported.jsonc).toContain('"name": "staging"');

      const imported = importEnvironmentJsonc(exported.jsonc, {
        createIfMissing: false,
      });
      expect(imported.environment.id).toBe(source.id);
      expect(imported.imported_keys).toEqual(["PD_REGION", "PD_SITE"]);
      expect(imported.imported_secret_refs).toEqual(["PD_TOKEN"]);
    } finally {
      await context.cleanup();
    }
  });
});
