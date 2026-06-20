import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  upsertEnvironmentEnvVar,
  upsertEnvironmentModelConfig,
  upsertEnvironmentPermission,
} from "../../src/models/environment.ts";
import { buildEnvironmentEditRows } from "../../src/services/environment-edit.ts";

describe("buildEnvironmentEditRows", () => {
  it("returns env vars, secret refs, model configs, and permissions", async () => {
    const context = await createInitializedTestContext("environment-edit-rows");

    try {
      const environment = createEnvironment({ name: "edit-test" });
      upsertEnvironmentEnvVar(environment.id, "FOO", "bar");
      addSecretRefToEnvironment(environment.id, "SECRET_KEY", "env", "SECRET_KEY");
      upsertEnvironmentModelConfig(environment.id, {
        name: "default",
        model: "gpt-4.1",
        provider: "openai",
      });
      upsertEnvironmentPermission(environment.id, {
        name: "repo-read",
        action: "allow",
        pattern: "github.com/acme/*",
      });

      expect(buildEnvironmentEditRows(environment.id)).toEqual([
        { kind: "env_var", key: "FOO", value: "bar" },
        { kind: "secret_ref", key: "SECRET_KEY", provider: "env", ref: "SECRET_KEY" },
        { kind: "model_config", name: "default", model: "gpt-4.1", provider: "openai" },
        {
          kind: "permission",
          name: "repo-read",
          action: "allow",
          pattern: "github.com/acme/*",
        },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
