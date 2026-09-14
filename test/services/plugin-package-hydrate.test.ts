import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getHarnesstapDir } from "../../src/db/connection.ts";
import {
  createPlugin,
  getPluginByName,
  getPluginResources,
  stampPluginOrigin,
} from "../../src/models/plugin-model.ts";
import { marketplaceCacheDir } from "../../src/services/marketplace-catalog.ts";
import { ensureUpstreamPluginResources } from "../../src/services/plugin-package-hydrate.ts";
import { setPluginOrigin } from "../../src/services/plugin-origin.ts";
import { runPluginDoctor } from "../../src/services/plugin-doctor.ts";
import { createInitializedTestContext, type TestContext } from "../helpers/db.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createInitializedTestContext("plugin-hydrate-");
});
afterEach(async () => {
  await ctx.cleanup();
});

function writeContext7Tree(root: string): void {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills", "docs"), { recursive: true });
  writeFileSync(
    join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "context7", version: "1.0.0" }),
  );
  writeFileSync(
    join(root, "skills", "docs", "SKILL.md"),
    "---\nname: docs\ndescription: lookup docs\n---\n# docs\n",
  );
  writeFileSync(
    join(root, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        context7: {
          type: "http",
          url: "https://mcp.context7.com/mcp",
        },
      },
    }),
  );
}

it("does not warn empty-plugin when an upstream package has on-disk resources", () => {
  const pluginRoot = join(
    marketplaceCacheDir(getHarnesstapDir(), "anthropics"),
    "plugins",
    "claude",
    "context7",
  );
  writeContext7Tree(pluginRoot);

  const plugin = createPlugin({
    name: "context7",
    version: "1.0.0",
    description: "Upstream plugin context7@anthropics",
    origin: "upstream",
  });
  setPluginOrigin(plugin.id, "upstream");
  stampPluginOrigin(plugin.id, { locator: "context7@anthropics" });

  expect(getPluginResources(plugin.id)).toHaveLength(0);

  const report = runPluginDoctor({ nameOrId: "context7" });
  expect(report.results.some((row) => row.check === "empty-plugin")).toBe(false);
  const attached = getPluginResources(plugin.id);
  expect(attached.some((row) => row.type === "skill" && row.name === "docs")).toBe(
    true,
  );
  expect(
    attached.some((row) => row.type === "mcp_server" && row.name === "context7"),
  ).toBe(true);
});

it("hydrates plugin detail membership from the nested install tree", () => {
  const pluginRoot = join(
    marketplaceCacheDir(getHarnesstapDir(), "anthropics"),
    "plugins",
    "claude",
    "context7",
  );
  writeContext7Tree(pluginRoot);
  const plugin = createPlugin({
    name: "context7",
    version: "1.0.0",
    origin: "upstream",
  });
  setPluginOrigin(plugin.id, "upstream");
  stampPluginOrigin(plugin.id, { locator: "context7@anthropics" });

  const hydrated = ensureUpstreamPluginResources(
    getPluginByName("context7", "1.0.0") ?? plugin,
  );
  expect(hydrated.some((row) => row.type === "skill")).toBe(true);
  expect(hydrated.some((row) => row.type === "mcp_server")).toBe(true);
});
