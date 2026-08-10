import { afterEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createResource } from "../../src/models/resource.ts";
import {
  addResourceToLayer,
  createLayer,
  createLayerFromSources,
} from "../../src/models/plugin-model.ts";
import {
  addSecretRefToEnvironment,
  createEnvironment,
  upsertEnvironmentEnvVar,
} from "../../src/models/environment.ts";

const ENV_KEYS = [
  "REQ_EXACT",
  "REQ_FUZZY_TOKEN",
  "MY_API_TOKEN",
  "PATH",
  "HOME",
  "NODE_ENV",
  "npm_config_registry",
];

describe("environment requirements service", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("collectRequirementsFromPlugins gathers needs, mcp env, and agent models", async () => {
    const context = await createInitializedTestContext("env-req-plugins");

    try {
      const plugin = createLayer({
        name: "req-test-plugin",
        needs: ["NEED_KEY", "SECRET_TOKEN"],
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
            MCP_KEY: "${MCP_KEY}",
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

      const requirementsService = await import(
        "../../src/services/environment-requirements.ts"
      );
      const result = requirementsService.collectRequirementsFromPlugins([plugin.id]);

      expect(result.plugin_ids).toEqual([plugin.id]);
      expect(result.configured_layer_ids).toEqual([]);
      expect(result.required_keys).toEqual(["MCP_KEY", "NEED_KEY", "SECRET_TOKEN"]);
      expect(result.key_sources.NEED_KEY).toEqual(["plugin_needs"]);
      expect(result.key_sources.MCP_KEY).toEqual(["mcp_env"]);
      expect(result.required_models).toEqual([{ name: "reviewer", model: "gpt-5" }]);
    } finally {
      await context.cleanup();
    }
  });

  it("collectRequirementsFromPlugins extracts header placeholder keys from mcp servers", async () => {
    const context = await createInitializedTestContext("env-req-mcp-headers");

    try {
      const plugin = createLayer({ name: "header-req-plugin" });
      const mcpServer = createResource({
        type: "mcp_server",
        name: "remote-api",
        description: "",
        content: "",
        metadata: {
          transport: "http",
          url: "https://mcp.example.com",
          headers: {
            Authorization: "Bearer ${API_TOKEN}",
            "X-Tenant": "${TENANT_ID}",
          },
        },
        source: "manual",
      });
      addResourceToLayer(plugin.id, mcpServer.id);

      const requirementsService = await import(
        "../../src/services/environment-requirements.ts"
      );
      const result = requirementsService.collectRequirementsFromPlugins([plugin.id]);

      expect(result.required_keys).toEqual(["API_TOKEN", "TENANT_ID"]);
      expect(result.key_sources.API_TOKEN).toEqual(["mcp_env"]);
      expect(result.key_sources.TENANT_ID).toEqual(["mcp_env"]);
    } finally {
      await context.cleanup();
    }
  });

  it("collectLayerRequirements resolves selectors and sets configured_layer_ids", async () => {
    const context = await createInitializedTestContext("env-req-layers");

    try {
      const plugin = createLayer({
        name: "layer-req-plugin",
        needs: ["LAYER_KEY"],
      });
      const configuredLayer = createLayerFromSources({
        name: "layer-req-configured",
        sourceLayerIds: [plugin.id],
      });

      const requirementsService = await import(
        "../../src/services/environment-requirements.ts"
      );
      const result = requirementsService.collectLayerRequirements([configuredLayer.id]);

      expect(result.configured_layer_ids).toEqual([configuredLayer.id]);
      expect(result.plugin_ids).toEqual([configuredLayer.id]);
      expect(result.required_keys).toEqual(["LAYER_KEY"]);
      expect(result.key_sources.LAYER_KEY).toEqual(["plugin_needs"]);
    } finally {
      await context.cleanup();
    }
  });

  it("collectLayerRequirements throws when selector is not found", async () => {
    const context = await createInitializedTestContext("env-req-missing-layer");

    try {
      const requirementsService = await import(
        "../../src/services/environment-requirements.ts"
      );
      expect(() =>
        requirementsService.collectLayerRequirements(["missing-layer-id"]),
      ).toThrow(/Configured layer not found/);
    } finally {
      await context.cleanup();
    }
  });

  it("analyzeEnvironmentGaps reports satisfied and missing keys", async () => {
    const context = await createInitializedTestContext("env-req-gaps");

    try {
      const plugin = createLayer({
        name: "gap-plugin",
        needs: ["SATISFIED_VAR", "SATISFIED_SECRET", "MISSING_VAR"],
      });
      const configuredLayer = createLayerFromSources({
        name: "gap-layer",
        sourceLayerIds: [plugin.id],
      });
      const environment = createEnvironment({
        name: "gap-env",
        description: "test",
      });
      upsertEnvironmentEnvVar(environment.id, "SATISFIED_VAR", "value");
      addSecretRefToEnvironment(environment.id, "SATISFIED_SECRET", "env", "SATISFIED_SECRET");

      const requirementsService = await import(
        "../../src/services/environment-requirements.ts"
      );
      const gaps = requirementsService.analyzeEnvironmentGaps(
        environment.id,
        configuredLayer.id,
      );

      expect(gaps).toEqual([
        {
          key: "MISSING_VAR",
          sources: ["plugin_needs"],
          status: "missing",
        },
        {
          key: "SATISFIED_SECRET",
          sources: ["plugin_needs"],
          status: "satisfied",
        },
        {
          key: "SATISFIED_VAR",
          sources: ["plugin_needs"],
          status: "satisfied",
        },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("suggestProcessEnvKeys returns exact, fuzzy, and noise buckets", async () => {
    const context = await createInitializedTestContext("env-req-suggest");

    try {
      process.env.REQ_EXACT = "exact-value";
      process.env.MY_API_TOKEN = "token-value";
      process.env.PATH = "/usr/bin";
      process.env.HOME = "/home/user";
      process.env.NODE_ENV = "test";
      process.env.npm_config_registry = "https://registry.npmjs.org";

      const requirementsService = await import(
        "../../src/services/environment-requirements.ts"
      );
      const result = requirementsService.suggestProcessEnvKeys(
        ["REQ_EXACT", "API_TOKEN", "REQ_FUZZY_TOKEN"],
        {
          processEnv: process.env,
        },
      );

      expect(result.exact).toEqual(["REQ_EXACT"]);
      expect(result.fuzzy).toContain("MY_API_TOKEN");
      expect(result.fuzzy).not.toContain("PATH");
      expect(result.fuzzy).not.toContain("HOME");
      expect(result.fuzzy).not.toContain("NODE_ENV");
      expect(result.fuzzy).not.toContain("npm_config_registry");
      expect(result.noise).toEqual(
        expect.arrayContaining(["PATH", "HOME", "NODE_ENV", "npm_config_registry"]),
      );
    } finally {
      await context.cleanup();
    }
  });
});
