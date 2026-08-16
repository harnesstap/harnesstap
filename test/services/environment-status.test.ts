import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  upsertEnvironmentEnvVar,
} from "../../src/models/environment.ts";
import { setGlobalActiveEnvironment } from "../../src/services/environment-session.ts";
import {
  detectEnvironmentStatus,
  detectNamedEnvironmentDrift,
} from "../../src/services/environment-status.ts";

describe("environment status", () => {
  it("reports secret resolution warnings without failing", async () => {
    const context = await createInitializedTestContext("environment-status-secret-warning");

    try {
      const environment = createEnvironment({ name: "status-env" });
      upsertEnvironmentEnvVar(environment.id, "PD_REGION", "eu");
      addSecretRefToEnvironment(environment.id, "PD_TOKEN", "file", "testvalue");
      setGlobalActiveEnvironment("status-env");

      const status = detectEnvironmentStatus();

      expect(status.effective_environment).toBe("status-env");
      expect(status.secret_warnings).toEqual([
        expect.objectContaining({
          key: "PD_TOKEN",
          message: expect.stringContaining('file "testvalue" is missing or unreadable'),
        }),
      ]);
      expect(status.has_drift).toBe(true);
      expect(status.drift).toEqual([
        expect.objectContaining({
          key: "PD_REGION",
          expected: "eu",
          kind: "missing",
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("compares a named environment's values to process env", async () => {
    const context = await createInitializedTestContext("environment-named-drift");
    const key = "HT_ENV_DRIFT_TEST_REGION";
    const previous = process.env[key];

    try {
      const environment = createEnvironment({ name: "named-drift" });
      upsertEnvironmentEnvVar(environment.id, key, "eu");

      delete process.env[key];
      expect(detectNamedEnvironmentDrift(environment.id)).toEqual([
        expect.objectContaining({ key, expected: "eu", actual: null, kind: "missing" }),
      ]);

      process.env[key] = "eu";
      expect(detectNamedEnvironmentDrift(environment.id)).toEqual([]);

      process.env[key] = "us";
      expect(detectNamedEnvironmentDrift(environment.id)).toEqual([
        expect.objectContaining({ key, expected: "eu", actual: "us", kind: "mismatch" }),
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous;
      }
      await context.cleanup();
    }
  });
});
