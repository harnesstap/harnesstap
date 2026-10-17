import { describe, expect, it } from "bun:test";
import { createPlugin } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import {
  attachProfileResource,
  detachProfileAttachment,
  getProfileDetail,
} from "../../src/services/profile-edit.ts";
import { createTestContext } from "../helpers/db.ts";

describe("profile edit with a dependency missing from the Library", () => {
  it("does not add a second copy when its row is attached again, and detaches by name", async () => {
    const context = await createTestContext("profile-edit-missing-dependency");
    try {
      context.schema.initializeSchema(context.connection.getDb());
      const profile = createPlugin({ name: "backend-qa", version: "1.0.0", tags: ["profile"] });
      addDependency(profile.id, "feature-dev", { versionConstraint: "1.0.0" });
      addDependency(profile.id, "superpowers", { versionConstraint: "5.1.0" });

      const before = getProfileDetail("backend-qa");
      const featureDev = before.dependencies.find((dep) => dep.dependency_name === "feature-dev");
      expect(featureDev?.resource_id).toBeTruthy();

      const again = await attachProfileResource("backend-qa", featureDev?.resource_id ?? "");
      expect(again.dependencies.map((dep) => `${dep.dependency_name} ${dep.version_constraint}`)).toEqual([
        "feature-dev 1.0.0",
        "superpowers 5.1.0",
      ]);

      const after = detachProfileAttachment("backend-qa", { dependencyName: "feature-dev" });
      expect(after.dependencies.map((dep) => dep.dependency_name)).toEqual(["superpowers"]);

      // Undo re-attaches the same row and keeps its constraint.
      const undone = await attachProfileResource("backend-qa", featureDev?.resource_id ?? "");
      expect(undone.dependencies.map((dep) => `${dep.dependency_name} ${dep.version_constraint}`).sort()).toEqual([
        "feature-dev 1.0.0",
        "superpowers 5.1.0",
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
