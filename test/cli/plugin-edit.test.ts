import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { upsertResource } from "../../src/models/resource.ts";
import { getPlugin, getPluginResources } from "../../src/models/plugin-model.ts";

describe("CLI plugin edit", () => {
  it("plugin edit applies selection from mocked wizard", async () => {
    const context = await createTestContext("cli-plugin-edit-apply");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "stack"]);
      const skill = upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      ).resource;

      const result = await runCli(["plugin", "edit", "stack"], {
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
      const plugin = getPlugin("stack");
      if (!plugin) throw new Error("Expected plugin");
      const names = getPluginResources(plugin.id).map((resource) => resource.name);
      expect(names).toContain("helper");
    } finally {
      await context.cleanup();
    }
  });

  it("plugin edit --format json --no-interactive prints membership snapshot", async () => {
    const context = await createTestContext("cli-plugin-edit-json");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "stack"]);
      const skill = upsertResource(
        makeResourceInput({ type: "skill", name: "helper" }),
        { policy: "overwrite" },
      ).resource;
      await runCli(["plugin", "edit", "stack", "--add", "helper", "--type", "skill", "--no-interactive"]);

      const result = await runCli(
        ["plugin", "edit", "stack", "--format", "json", "--no-interactive"],
        { isTTY: false },
      );

      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.plugin.name).toBe("stack");
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

  it("plugin edit fails off TTY without json format", async () => {
    const context = await createTestContext("cli-plugin-edit-non-tty");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "stack"]);

      const result = await runCli(["plugin", "edit", "stack"], {
        isTTY: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/requires an interactive terminal/i);
      expect(result.stderr).toContain("--add");
      expect(result.stderr).toContain("--remove");
    } finally {
      await context.cleanup();
    }
  });
});
