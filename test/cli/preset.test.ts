import { describe, expect, it } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("CLI preset", () => {
  it("creates, shows, associates, removes, and deletes presets", async () => {
    const context = await createTestContext("cli-preset");

    try {
      await runCli(["init"]);

      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const resource = resourceModel.createResource(
        makeResourceInput({
          type: "skill",
          name: "shared-skill",
          description: "Shared helper",
          content: "# Shared",
        }),
      );

      await runCli([
        "preset",
        "create",
        "team",
        "--description",
        "Team preset",
        "--tags",
        "core,shared",
      ]);
      await runCli(["preset", "add", "team", resource.id]);

      const presetShow = await runCli(["preset", "show", "team"]);
      expect(presetShow.stdout).toContain("team");
      expect(presetShow.stdout).toContain("shared-skill");

      await runCli(["preset", "remove", "team", resource.id]);
      expect(presetModel.getPresetResources(presetModel.getPreset("team")!.id)).toHaveLength(0);

      await runCli(["preset", "delete", "team"]);
      expect(presetModel.getPreset("team")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
