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
  exportEnvironmentToml,
  importEnvironmentToml,
} from "../../src/services/environment-import-export.ts";

describe("environment import/export service", () => {
  it("imports TOML with comments", async () => {
    const context = await createInitializedTestContext("env-import-toml");

    try {
      const result = importEnvironmentToml(`# environment for local testing
name = "local"

[environments.local.values]
PD_REGION = "us"
PD_SITE = "us1"

[environments.local.secret_refs.PD_TOKEN]
provider = "env"
ref = "PD_TOKEN"
`);

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

  it("roundtrips environment values and secret refs via export/import TOML", async () => {
    const context = await createInitializedTestContext("env-export-roundtrip");

    try {
      const source = createEnvironment({ name: "staging" });
      upsertEnvironmentEnvVar(source.id, "PD_REGION", "eu");
      upsertEnvironmentEnvVar(source.id, "PD_SITE", "eu1");
      addSecretRefToEnvironment(source.id, "PD_TOKEN", "env", "PD_TOKEN");

      const exported = exportEnvironmentToml("staging");
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
      expect(exported.toml).toContain('name = "staging"');

      const imported = importEnvironmentToml(exported.toml, {
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
