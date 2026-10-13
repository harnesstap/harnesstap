import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { addResourceToPlugin, createPlugin } from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { replaceOpaqueFiles } from "../../../src/services/agent-plugins/opaque.ts";
import {
  buildApPackageFiles,
  type ApPackageFiles,
} from "../../../src/services/agent-plugins/files.ts";
import {
  assertAgentPluginsPublishable,
  SpecPublishError,
} from "../../../src/services/agent-plugins/publish-gate.ts";
import { AP_MCP_SCHEMA_URL, AP_SCHEMA_URL } from "../../../src/services/agent-plugins/schema-registry.ts";
import { publishPluginToCatalogs } from "../../../src/services/plugin-publish.ts";
import { exportScopedMigration, resolveExportScope } from "../../../src/services/migrate-scope.ts";
import { loadVerifiedPackageFiles } from "../../../src/services/apm-bundle.ts";
import { specErrors } from "../../helpers/agent-plugins-spec.ts";
import { createInitializedTestContext, type TestContext } from "../../helpers/db.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-publish-gate-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function utf8(content: string): ApPackageFiles[string] {
  return { encoding: "utf8", content };
}

function manifest(schema: string): string {
  return JSON.stringify({
    $schema: schema,
    name: "demo",
    version: "1.0.0",
  });
}

describe("publish gate", () => {
  it("blocks a non-canonical schema and an unusable mcp.json", () => {
    expect(() =>
      assertAgentPluginsPublishable({
        "plugin.json": utf8(manifest("https://agent-plugins.org/schemas/9.9.9/plugin.schema.json")),
      }),
    ).toThrow(SpecPublishError);

    expect(() =>
      assertAgentPluginsPublishable({
        "plugin.json": utf8(manifest(AP_SCHEMA_URL)),
        "mcp.json": utf8(JSON.stringify({ nope: true })),
      }),
    ).toThrow(/mcp.json is invalid/);
  });

  it("treats a skipped server as a warning unless --strict", () => {
    const files: ApPackageFiles = {
      "plugin.json": utf8(manifest(AP_SCHEMA_URL)),
      "mcp.json": utf8(JSON.stringify({
        $schema: AP_MCP_SCHEMA_URL,
        mcpServers: {
          ok: { type: "stdio", command: "echo" },
          bad: { type: "stdio", command: "echo hi" },
        },
      })),
    };
    const warnings: string[] = [];
    expect(assertAgentPluginsPublishable(files, { warnings }).join("\n")).toContain("bad");
    expect(() => assertAgentPluginsPublishable(files, { strict: true, warnings: [] })).toThrow(
      /was skipped/,
    );
  });

  it("blocks publish on a renamed skill only when strict", async () => {
    const plugin = createPlugin({
      name: "ship-plugin",
      version: "1.0.0",
      description: "Ship",
    });
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "skill",
        name: "Ship It",
        description: "Ship the project",
        content: "# Ship\n",
        metadata: {},
        source: "test",
      }).id,
    );
    const open = await publishPluginToCatalogs(plugin, []);
    expect(open).toEqual([]);
    await expect(publishPluginToCatalogs(plugin, [], { strict: true })).rejects.toThrow(/renamed/);
  });
});

describe("vendor extensions", () => {
  it("writes Copilot files and Codex hooks, and leaves an existing file in place", () => {
    const plugin = createPlugin({
      name: "vendor-demo",
      version: "1.2.0",
      description: "Vendor demo",
    });
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "agent",
        name: "helper",
        description: "Helps",
        content: "# Help\n",
        metadata: {},
        source: "test",
      }).id,
    );
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "command",
        name: "ship",
        description: "Ship",
        content: "# Ship\n",
        metadata: {},
        source: "test",
      }).id,
    );
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "hook",
        name: "format",
        description: "",
        content: "",
        metadata: { event: "PostToolUse", script: "echo hi" },
        source: "test",
      }).id,
    );
    replaceOpaqueFiles(plugin.id, {
      "com.github.copilot/agents/helper.agent.md": { encoding: "utf8", content: "original\n" },
    });

    const plain = buildApPackageFiles(plugin.id);
    expect(plain["com.github.copilot/commands/ship.md"]).toBeUndefined();

    const warnings: string[] = [];
    const files = buildApPackageFiles(plugin.id, { vendorExtensions: true, warnings });
    expect(files["com.github.copilot/agents/helper.agent.md"]?.content).toBe("original\n");
    expect(files["com.github.copilot/commands/ship.md"]?.content).toContain("# Ship");
    expect(files["com.github.copilot/hooks/hooks.json"]?.content).toContain("PostToolUse");
    expect(files["com.openai/hooks/hooks.json"]?.content).toContain("PostToolUse");
    expect(files["com.openai/agents/helper.md"]).toBeUndefined();
    const manifestJson = JSON.parse(files["plugin.json"]?.content ?? "{}") as {
      extensions: Record<string, { hooks?: string }>;
    };
    expect(manifestJson.extensions["com.openai"]?.hooks).toBe("./com.openai/hooks/hooks.json");
    expect(specErrors("plugin", manifestJson)).toEqual([]);
    expect(warnings.join("\n")).toContain("left com.github.copilot/agents/helper.agent.md");
    expect(warnings.join("\n")).toContain("not copied under com.openai");
  });
});

describe("zip export", () => {
  it("writes a zip and refuses to replace a directory", () => {
    const plugin = createPlugin({ name: "zip-demo", version: "1.0.0", description: "Zip" });
    const zipPath = join(ctx.homeDir, "zip-demo.zip");
    const resolved = resolveExportScope({
      plugin: plugin.name,
      file: zipPath,
    });
    expect(resolved.archive).toBe(true);
    expect(resolved.singleFile).toBe(false);
    const written = exportScopedMigration(resolved, { plugin: plugin.name, file: zipPath });
    expect(written.output).toBe(zipPath);
    const loaded = loadVerifiedPackageFiles(zipPath);
    expect(loaded["plugin.json"]?.content).toContain("zip-demo");

    const dir = join(ctx.homeDir, "already-dir.zip");
    mkdirSync(dir);
    expect(() =>
      exportScopedMigration(
        resolveExportScope({ plugin: plugin.name, file: dir, archive: true }),
        { plugin: plugin.name, archive: true },
      ),
    ).toThrow(/Refusing to replace directory/);
  });
});
