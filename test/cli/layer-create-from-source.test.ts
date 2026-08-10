import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("CLI layer create --from", () => {
  it("creates a configured layer without installing skills to hub", async () => {
    const context = await createTestContext("cli-layer-create-from");
    try {
      await runCli(["init", "--main", "codex"]);
      const result = await runCli([
        "layer",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "caveman,tdd",
        "--yes",
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.layer).toBe("dbt-expert");
      expect(payload.attached.sort()).toEqual(["caveman", "tdd"]);
      expect(payload.installed).toEqual([]);
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("fails when the layer already exists without --on-conflict", async () => {
    const context = await createTestContext("cli-layer-create-from-conflict");
    try {
      await runCli(["init"]);
      await runCli(["layer", "create", "dbt-expert"]);
      const result = await runCli([
        "layer",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "caveman",
        "--yes",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/Layer already exists/);
    } finally {
      await context.cleanup();
    }
  });

  it("merges skill refs with --on-conflict merge", async () => {
    const context = await createTestContext("cli-layer-create-from-merge");
    try {
      await runCli(["init"]);
      await runCli([
        "layer",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "caveman",
        "--yes",
      ]);
      const result = await runCli([
        "layer",
        "create",
        "dbt-expert",
        "--from",
        fixture,
        "--skill",
        "tdd",
        "--on-conflict",
        "merge",
        "--yes",
        "--format",
        "json",
      ]);
      expect(result.exitCode ?? 0).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.conflict_policy).toBe("merge");

      const layerModel = await import("../../src/models/plugin-model.ts");
      const layer = layerModel.getLayer("dbt-expert");
      if (!layer) throw new Error("Expected dbt-expert layer");
      const attached = layerModel.getLayerResources(layer.id);
      expect(
        attached
          .filter((resource) => resource.type === "skill")
          .map((resource) => resource.name)
          .sort(),
      ).toEqual(["caveman", "tdd"]);
    } finally {
      await context.cleanup();
    }
  });
});
