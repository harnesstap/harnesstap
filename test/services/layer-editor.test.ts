import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import {
  exportLayerDefinition,
  resolveLayerDefinitionPath,
} from "../../src/services/layer-editor.ts";
import { parseTestLayerToml } from "../helpers/transport-fixtures.ts";

describe("layer editor service", () => {
  it("resolves a stable definition path under the harnesstap home", async () => {
    const context = await createTestContext("layer-editor-path");
    try {
      initializeSchema(getDb());
      const layerModel = await import("../../src/models/layer-model.ts");
      const layer = layerModel.createLayer({ name: "team-stack", version: "1.2.0" });

      expect(resolveLayerDefinitionPath(layer)).toBe(
        join(context.homeDir, ".harnesstap", "layers", "team-stack@1.2.0.harnesstap.toml"),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("exports the current layer state to the definition path", async () => {
    const context = await createTestContext("layer-editor-export");
    try {
      initializeSchema(getDb());
      const layerModel = await import("../../src/models/layer-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const layer = layerModel.createLayer({ name: "team-stack", version: "1.2.0" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      layerModel.addResourceToLayer(layer.id, resource.id);

      const definitionPath = exportLayerDefinition(layer);
      expect(existsSync(definitionPath)).toBe(true);

      const parsed = parseTestLayerToml(readFileSync(definitionPath, "utf-8"));
      expect(parsed.layers[0]?.name).toBe("team-stack");
      expect(parsed.layers[0]?.version).toBe("1.2.0");
      expect(parsed.layers[0]?.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "skill", name: "shared-skill" }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });
});

describe("CLI layer editor", () => {
  it("exports the layer definition and prints the path as json", async () => {
    const context = await createTestContext("cli-layer-editor-json");
    try {
      await runCli(["init"]);
      const layerModel = await import("../../src/models/layer-model.ts");
      layerModel.createLayer({ name: "team-stack", version: "1.2.0" });

      const result = await runCli([
        "layer",
        "editor",
        "team-stack",
        "--format",
        "json",
        "--no-interactive",
      ]);

      const payload = JSON.parse(result.stdout) as { layer: string; path: string };
      expect(payload.layer).toBe("team-stack@1.2.0");
      expect(payload.path).toBe(
        join(context.homeDir, ".harnesstap", "layers", "team-stack@1.2.0.harnesstap.toml"),
      );
      expect(existsSync(payload.path)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("fails when the layer does not exist", async () => {
    const context = await createTestContext("cli-layer-editor-missing");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "layer",
        "editor",
        "missing-layer",
        "--format",
        "json",
        "--no-interactive",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Layer not found");
    } finally {
      await context.cleanup();
    }
  });
});
