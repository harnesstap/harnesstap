import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addResourceToEnvironment,
  createEnvironment,
  getEnvironmentResources,
} from "../../src/models/environment.ts";

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
});
