import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import { createLayer, addResourceToLayer } from "../../src/models/layer-model.ts";
import { createLayerFromSources } from "../../src/models/layer-model.ts";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { getEnvironmentByName } from "../../src/models/environment.ts";

const ENV_KEYS = ["PROC_REGION", "PROC_TOKEN"];

describe("environment capture service", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("collects requirements and resolves values in scan > library > process order", async () => {
    const context = await createInitializedTestContext("env-capture-resolution");

    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".claude", "settings.json"),
        JSON.stringify({
          env: {
            SCAN_KEY: "scan-value",
          },
        }),
        "utf-8",
      );

      createResource({
        type: "env_var",
        name: "SCAN_KEY",
        description: "",
        content: "",
        metadata: { key: "SCAN_KEY", value: "library-scan-value" },
        source: "manual",
      });
      createResource({
        type: "env_var",
        name: "LIB_KEY",
        description: "",
        content: "",
        metadata: { key: "LIB_KEY", value: "library-value" },
        source: "manual",
      });

      process.env.PROC_REGION = "process-value";
      process.env.PROC_TOKEN = "process-secret";

      const plugin = createLayer({
        name: "capture-test-plugin",
        needs: ["SCAN_KEY", "LIB_KEY", "PROC_TOKEN", "MISSING_KEY"],
      });
      const mcpServer = createResource({
        type: "mcp_server",
        name: "posthog",
        description: "",
        content: "",
        metadata: {
          transport: "stdio",
          command: "node",
          env: {
            PROC_REGION: `\${PROC_REGION}`,
          },
        },
        source: "manual",
      });
      const agent = createResource({
        type: "agent",
        name: "reviewer",
        description: "",
        content: "",
        metadata: { model: "gpt-5" },
        source: "manual",
      });
      addResourceToLayer(plugin.id, mcpServer.id);
      addResourceToLayer(plugin.id, agent.id);

      const configuredLayer = createLayerFromSources({
        name: "capture-test-layer",
        sourceLayerIds: [plugin.id],
      });

      const captureService = await import("../../src/services/environment-capture.ts");
      const preview = await captureService.previewEnvironmentCapture({
        mode: "capture",
        environmentName: "preview",
        projectRoot: context.projectDir,
        layerSelectors: [configuredLayer.id],
      });

      expect(preview.requirements.required_keys).toEqual([
        "LIB_KEY",
        "MISSING_KEY",
        "PROC_REGION",
        "PROC_TOKEN",
        "SCAN_KEY",
      ]);
      expect(preview.requirements.key_sources.PROC_REGION).toEqual(["mcp_env"]);
      expect(preview.requirements.key_sources.PROC_TOKEN).toEqual(["plugin_needs"]);
      expect(preview.values.SCAN_KEY).toBe("scan-value");
      expect(preview.values.LIB_KEY).toBe("library-value");
      expect(preview.values.PROC_REGION).toBe("process-value");
      expect(preview.secret_refs.PROC_TOKEN).toEqual({
        provider: "env",
        ref: "PROC_TOKEN",
      });
      expect(preview.model_configs).toEqual([{ name: "reviewer", model: "gpt-5" }]);
      expect(preview.missing_keys).toEqual([
        expect.objectContaining({
          key: "MISSING_KEY",
          mode: "warn",
        }),
      ]);
      expect(preview.strict_failed).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("marks strict mode capture as failed and skips persistence", async () => {
    const context = await createInitializedTestContext("env-capture-strict");

    try {
      setHarnessPreference({ main_harness: "claude-code", alias_harnesses: [] });
      mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.projectDir, ".claude", "settings.json"),
        JSON.stringify({ env: {} }),
        "utf-8",
      );

      const plugin = createLayer({
        name: "strict-plugin",
        needs: ["MISSING_STRICT_KEY"],
      });
      const configuredLayer = createLayerFromSources({
        name: "strict-layer",
        sourceLayerIds: [plugin.id],
      });

      const captureService = await import("../../src/services/environment-capture.ts");
      const result = await captureService.captureOrRefreshEnvironment({
        mode: "capture",
        environmentName: "strict-env",
        projectRoot: context.projectDir,
        layerSelectors: [configuredLayer.id],
        strict: true,
      });

      expect(result.strict_failed).toBe(true);
      expect(result.persisted).toBe(false);
      expect(result.missing_keys).toEqual([
        expect.objectContaining({
          key: "MISSING_STRICT_KEY",
          mode: "strict",
        }),
      ]);
      expect(getEnvironmentByName("strict-env")).toBeUndefined();
    } finally {
      await context.cleanup();
    }
  });
});
