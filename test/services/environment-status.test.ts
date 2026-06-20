import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  upsertEnvironmentEnvVar,
} from "../../src/models/environment.ts";
import { setGlobalActiveEnvironment } from "../../src/services/environment-session.ts";
import { detectEnvironmentStatus } from "../../src/services/environment-status.ts";

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
});
