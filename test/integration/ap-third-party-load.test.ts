import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { addResourceToPlugin, createPlugin } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import {
  buildApPackageFiles,
  writeApPackageFiles,
} from "../../src/services/agent-plugins/files.ts";
import { loadAgentPlugin } from "../fixtures/agent-plugins/reference-loader.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-3p-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function attach(pluginId: string, input: Parameters<typeof createResource>[0]): void {
  addResourceToPlugin(pluginId, createResource(input).id);
}

describe("third-party client load", () => {
  it("resolves skills and MCP servers from a HarnessTap-produced package", () => {
    createPlugin({ name: "base" });
    const plugin = createPlugin({ name: "My Plugin", version: "2.0.0" });
    addDependency(plugin.id, "base", { versionConstraint: "^1.0.0" });
    attach(plugin.id, {
      type: "skill",
      name: "deploy",
      description: "Deployment workflow",
      content: "# Deploy\n\nRun it.",
      metadata: {},
      source: "test",
    });
    attach(plugin.id, {
      type: "mcp_server",
      name: "search",
      description: "",
      content: "",
      metadata: { transport: "stdio", command: "npx", args: ["-y", "search"] },
      source: "test",
    });
    attach(plugin.id, {
      type: "rule",
      name: "style",
      description: "",
      content: "Use tabs.",
      metadata: { globs: [], always_apply: true },
      source: "test",
    });

    const root = join(ctx.projectDir, "pkg");
    writeApPackageFiles(buildApPackageFiles(plugin.id), root);

    const loaded = loadAgentPlugin(root);
    expect(loaded.name).toBe("my-plugin");
    expect(loaded.version).toBe("2.0.0");
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0]).toMatchObject({
      name: "deploy",
      description: "Deployment workflow",
    });
    expect(loaded.skills[0]?.body).toContain("# Deploy");
    expect(Object.keys(loaded.mcpServers)).toEqual(["search"]);
  });

  it("keeps HarnessTap-only material out of the standard paths", () => {
    const plugin = createPlugin({ name: "mixed", version: "1.0.0" });
    attach(plugin.id, {
      type: "rule",
      name: "style",
      description: "",
      content: "Use tabs.",
      metadata: { globs: [], always_apply: true },
      source: "test",
    });
    const root = join(ctx.projectDir, "mixed-pkg");
    writeApPackageFiles(buildApPackageFiles(plugin.id), root);

    // A naive consumer sees no skills and no MCP servers and never reads
    // com.harnesstap/, so the rule is invisible to it rather than malformed.
    const loaded = loadAgentPlugin(root);
    expect(loaded.skills).toEqual([]);
    expect(loaded.mcpServers).toEqual({});
    expect(existsSync(join(root, "com.harnesstap", "rules", "style.md"))).toBe(true);
  });
});
