import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { importSkillPackage } from "../../src/services/skill-package-import.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-package-import", () => {
  it("persists all skills under source namespace", async () => {
    const context = await createInitializedTestContext("skill-package-import");
    try {
      const result = await importSkillPackage({
        rootPath: fixture,
        sourceLabel: "mattpocock/skills",
        gitSha: "abc123",
        gitUrl: "https://github.com/mattpocock/skills.git",
      });

      expect(result.snapshot.source_kind).toBe("skill-package");
      expect(result.resources).toHaveLength(3);

      const { findResourceByKey } = await import("../../src/models/resource.ts");
      const caveman = findResourceByKey("skill", "caveman", "mattpocock/skills");
      expect(caveman).toMatchObject({
        type: "skill",
        name: "caveman",
        namespace: "mattpocock/skills",
        description: "Caveman debugging skill",
      });
    } finally {
      await context.cleanup();
    }
  });
});
