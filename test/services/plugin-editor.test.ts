import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { getDb } from "../../src/db/connection.ts";
import { initializeSchema } from "../../src/db/schema.ts";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";
import {
  exportPluginDefinition,
  resolvePluginDefinitionPath,
} from "../../src/services/plugin-editor.ts";
import { parseApEnvelope } from "../../src/services/agent-plugins/envelope.ts";
import { parseApPackageFiles } from "../../src/services/agent-plugins/import.ts";

describe("plugin editor service", () => {
  it("resolves a stable definition path under the harnesstap home", async () => {
    const context = await createTestContext("plugin-editor-path");
    try {
      initializeSchema(getDb());
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const plugin = pluginModel.createPlugin({ name: "team-stack", version: "1.2.0" });

      expect(resolvePluginDefinitionPath(plugin)).toBe(
        join(context.homeDir, ".harnesstap", "plugins", "team-stack@1.2.0.ap.json"),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("exports the current plugin state to the definition path", async () => {
    const context = await createTestContext("plugin-editor-export");
    try {
      initializeSchema(getDb());
      const pluginModel = await import("../../src/models/plugin-model.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const plugin = pluginModel.createPlugin({ name: "team-stack", version: "1.2.0" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );
      pluginModel.addResourceToPlugin(plugin.id, resource.id);

      const definitionPath = exportPluginDefinition(plugin);
      expect(existsSync(definitionPath)).toBe(true);

      const parsed = parseApPackageFiles(
        parseApEnvelope(readFileSync(definitionPath, "utf-8"), definitionPath),
      );
      expect(parsed.sourceName).toBe("team-stack");
      expect(parsed.version).toBe("1.2.0");
      expect(parsed.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "skill", name: "shared-skill" }),
        ]),
      );
    } finally {
      await context.cleanup();
    }
  });
});

describe("CLI plugin editor", () => {
  it("exports the plugin definition and prints the path as json", async () => {
    const context = await createTestContext("cli-plugin-editor-json");
    try {
      await runCli(["init"]);
      const pluginModel = await import("../../src/models/plugin-model.ts");
      pluginModel.createPlugin({ name: "team-stack", version: "1.2.0" });

      const result = await runCli([
        "plugin",
        "editor",
        "team-stack",
        "--format",
        "json",
        "--no-interactive",
      ]);

      const payload = JSON.parse(result.stdout) as { plugin: string; path: string };
      expect(payload.plugin).toBe("team-stack@1.2.0");
      expect(payload.path).toBe(
        join(context.homeDir, ".harnesstap", "plugins", "team-stack@1.2.0.ap.json"),
      );
      expect(existsSync(payload.path)).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("fails when the plugin does not exist", async () => {
    const context = await createTestContext("cli-plugin-editor-missing");
    try {
      await runCli(["init"]);
      const result = await runCli([
        "plugin",
        "editor",
        "missing-plugin",
        "--format",
        "json",
        "--no-interactive",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Plugin not found");
    } finally {
      await context.cleanup();
    }
  });
});
