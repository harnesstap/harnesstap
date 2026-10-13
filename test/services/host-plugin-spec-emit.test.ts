import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { emitHostPluginTrees } from "../../src/services/host-plugin-serialize.ts";
import type { Resource } from "../../src/types.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const CORE = join(
  import.meta.dirname,
  "../fixtures/agent-plugins-spec/conformance/agent-plugins-conformance-core",
);

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("host-plugin-spec-emit-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function pin(): Resource {
  return makeResource({
    type: "plugin",
    name: "agent-plugins-conformance-core",
    namespace: "conformance",
    origin_kind: "marketplace_link",
    origin_ref: "agent-plugins-conformance-core@conformance",
    content: "{}",
    metadata: {
      source_kind: "marketplace",
      marketplace_name: "conformance",
      resolved_version: "0.1.0",
    },
  });
}

function installCopy(home: string): string {
  const root = join(
    home,
    ".claude/plugins/cache/conformance/agent-plugins-conformance-core/0.1.0",
  );
  cpSync(CORE, root, { recursive: true });
  writeTextFile(
    join(root, "com.harnesstap/commands/ship.md"),
    "---\ndescription: Ship\n---\n\nShip it.\n",
  );
  return root;
}

describe("emitted Agent Plugins host trees", () => {
  it("rewrites Cursor mcp.json variables and leaves the canonical package in place", () => {
    const home = ctx.homeDir;
    const canonical = readFileSync(join(CORE, "mcp.json"), "utf8");
    const root = installCopy(home);
    const files = emitHostPluginTrees([pin()], { layout: "cursor", homeRoot: home });
    const mcp = files.find((file) => file.path.endsWith("/mcp.json"));
    expect(mcp?.path).toBe(
      ".cursor/plugins/local/agent-plugins-conformance-core/mcp.json",
    );
    expect(mcp?.content).toContain("${CURSOR_PLUGIN_ROOT}");
    expect(mcp?.content).toContain("${PLUGIN_ROOT_SUFFIX}");
    expect(mcp?.content).toContain("${APC_UNKNOWN}");
    expect(mcp?.content).toContain("$APC_VALUE");
    expect(mcp?.content).not.toContain("${PLUGIN_ROOT}");
    expect(mcp?.content).not.toContain("${PLUGIN_DATA}");
    expect(mcp?.content).toContain("plugin-data/agent-plugins-conformance-core");
    expect(mcp?.content).toContain("streamable-http");
    expect(readFileSync(join(CORE, "mcp.json"), "utf8")).toBe(canonical);
    expect(readFileSync(join(root, "mcp.json"), "utf8")).toBe(canonical);
    expect(files.some((file) => file.path.endsWith(".claude-plugin/plugin.json"))).toBe(false);
  });

  it("translates a Claude copy and merges shared config key by key", () => {
    const home = ctx.homeDir;
    installCopy(home);
    writeTextFile(
      join(home, ".claude/settings.json"),
      `${JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        enabledPlugins: { "other@market": true },
      }, null, 2)}\n`,
    );
    writeTextFile(
      join(home, ".claude/plugins/installed_plugins.json"),
      `${JSON.stringify({
        version: 2,
        plugins: {
          "other@market": [{ scope: "user", installPath: "cache/market/other/1.0.0", version: "1.0.0" }],
        },
      }, null, 2)}\n`,
    );

    const files = emitHostPluginTrees([pin()], { layout: "claude-code", homeRoot: home });
    const mcp = files.find((file) => file.path.endsWith("/.mcp.json"));
    expect(mcp?.content).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(mcp?.content).toContain("${CLAUDE_PLUGIN_DATA}");
    expect(mcp?.content).toContain("${PLUGIN_ROOT_SUFFIX}");
    expect(mcp?.content).not.toContain("${PLUGIN_ROOT}");
    expect(mcp?.content).not.toContain("streamable-http");
    expect(files.some((file) => file.path.endsWith("/mcp.json"))).toBe(false);

    const manifest = files.find((file) => file.path.endsWith(".claude-plugin/plugin.json"));
    expect(JSON.parse(manifest?.content ?? "{}")).toMatchObject({
      name: "agent-plugins-conformance-core",
      version: "0.1.0",
      description: "Core skill and MCP fixtures for Agent Plugins 1.0.0 conformance checks.",
    });
    expect(files.some((file) => file.path.endsWith("com.harnesstap/commands/ship.md"))).toBe(true);
    expect(files.some((file) => file.path.endsWith("/commands/ship.md"))).toBe(true);

    const settings = JSON.parse(
      files.find((file) => file.path === ".claude/settings.json")?.content ?? "{}",
    ) as { permissions?: { allow?: string[] }; enabledPlugins?: Record<string, boolean> };
    expect(settings.permissions?.allow).toEqual(["Bash(ls)"]);
    expect(settings.enabledPlugins?.["other@market"]).toBe(true);
    expect(settings.enabledPlugins?.["agent-plugins-conformance-core@conformance"]).toBe(true);

    const installed = JSON.parse(
      files.find((file) => file.path === ".claude/plugins/installed_plugins.json")?.content ?? "{}",
    ) as { plugins?: Record<string, unknown> };
    expect(installed.plugins?.["other@market"]).toBeDefined();
    expect(installed.plugins?.["agent-plugins-conformance-core@conformance"]).toBeDefined();
  });
});
