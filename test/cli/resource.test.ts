import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI resource", () => {
  it("lists, shows, and deletes resources", async () => {
    const context = await createTestContext("cli-resource");

    try {
      await runCli(["init"]);

      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
          content: "# Shared",
        }),
      );

      const resourceList = await runCli(["resource", "list"]);
      const resourceShow = await runCli(["resource", "show", resource.id]);

      expect(resourceList.stdout).toContain("shared-skill");
      expect(resourceShow.stdout).toContain("# Shared");

      await runCli(["resource", "delete", resource.id]);
      expect(resourceModel.getResource(resource.id)).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
