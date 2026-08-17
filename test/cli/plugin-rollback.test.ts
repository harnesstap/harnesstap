import { describe, expect, it } from "bun:test";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import {
  addResourceToPlugin,
  getPlugin,
  getPluginByName,
  getPluginResources,
} from "../../src/models/plugin-model.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import { createResource, upsertResource } from "../../src/models/resource.ts";

describe("CLI plugin rollback", () => {
  it("restores a frozen version with --yes", async () => {
    const context = await createTestContext("cli-plugin-rollback-yes");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      const helper = createResource(makeResourceInput({ type: "skill", name: "helper" }));
      const created = getPlugin("alpha");
      expect(created).toBeDefined();
      addResourceToPlugin(created!.id, helper.id);
      await runCli(["plugin", "cut", "alpha", "--version", "1.1.0"]);
      upsertResource(makeResourceInput({ type: "skill", name: "other" }), {
        policy: "overwrite",
      });
      await runCli([
        "plugin",
        "edit",
        "alpha",
        "--add",
        "other",
        "--type",
        "skill",
        "--no-interactive",
      ]);

      const result = await runCli([
        "plugin",
        "rollback",
        "alpha",
        "--to",
        "1.0.0",
        "--yes",
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout) as { version: string; dirty: boolean };
      expect(payload.version).toBe("1.1.0");
      expect(payload.dirty).toBe(true);

      const head = getPlugin("alpha");
      expect(head?.version).toBe("1.1.0");
      expect(head?.dirty).toBe(true);
      expect(getPluginResources(head!.id).map((resource) => resource.name)).toEqual([
        "helper",
      ]);
      expect(getPluginByName("alpha", "1.0.0")?.frozen_at).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("refuses without --yes when non-interactive", async () => {
    const context = await createTestContext("cli-plugin-rollback-require-yes");
    try {
      await runCli(["init"]);
      await runCli(["plugin", "create", "alpha", "--version", "1.0.0"]);
      await runCli(["plugin", "cut", "alpha", "--version", "1.1.0"]);
      const result = await runCli(["plugin", "rollback", "alpha", "--to", "1.0.0"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--yes");
      expect(getPlugin("alpha")?.dirty).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
