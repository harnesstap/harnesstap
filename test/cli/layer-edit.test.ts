import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { upsertResource } from "../../src/models/resource.ts";
import { getLayer, getLayerResources } from "../../src/models/layer-model.ts";

describe("CLI layer edit", () => {
  it("layer edit applies selection from mocked wizard", async () => {
    const context = await createTestContext("cli-layer-edit-apply");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "stack"]);
      const skill = upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      ).resource;

      const result = await runCli(["layer", "edit", "stack"], {
        isTTY: true,
        promptResponses: [{
          value: [
            {
              id: skill.id,
              type: "skill",
              name: "helper",
              namespace: "",
              display_name: "helper",
              description: "Helper",
              source: "manual",
              origin_kind: "manual",
              origin_ref: "",
              content_hash: "",
              content: "# Helper",
              metadata: {},
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-02T00:00:00.000Z",
              checked: true,
            },
          ],
        }],
      });

      expect(result.exitCode ?? 0).toBe(0);
      expect(result.stdout).toContain("+1 added");
      const layer = getLayer("stack");
      if (!layer) throw new Error("Expected layer");
      const names = getLayerResources(layer.id).map((resource) => resource.name);
      expect(names).toContain("helper");
    } finally {
      await context.cleanup();
    }
  });

  it("layer edit --format json --no-interactive prints membership snapshot", async () => {
    const context = await createTestContext("cli-layer-edit-json");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "stack"]);
      const skill = upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      ).resource;
      await runCli([
        "layer",
        "combine",
        "stack",
        "helper",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const result = await runCli(
        ["layer", "edit", "stack", "--format", "json", "--no-interactive"],
        { isTTY: false },
      );

      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.layer.name).toBe("stack");
      expect(payload.attachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "skill:helper",
            type: "skill",
            id: skill.id,
          }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("layer edit fails off TTY without json format", async () => {
    const context = await createTestContext("cli-layer-edit-non-tty");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "stack"]);

      const result = await runCli(["layer", "edit", "stack"], {
        isTTY: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/interactive only/i);
      expect(result.stderr).toContain("layer combine");
    } finally {
      await context.cleanup();
    }
  });
});
