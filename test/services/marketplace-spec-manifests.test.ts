import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { AP_SCHEMA_URL } from "../../src/services/agent-plugins/schema-registry.ts";
import {
  listPluginsFromMarketplaceRoot,
  marketplaceRootWarnings,
} from "../../src/services/marketplace-catalog.ts";
import { parseCodexMarketplaceManifest } from "../../src/services/marketplace-catalog-parse.ts";
import { scanPluginSourceSync } from "../../src/services/plugin-source-import.ts";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeJson(path: string, body: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

function writeSpecPlugin(root: string, relative: string): void {
  const pluginRoot = join(root, relative);
  writeJson(join(pluginRoot, "plugin.json"), {
    $schema: AP_SCHEMA_URL,
    name: "demo",
    version: "1.2.0",
    description: "Demo plugin",
  });
  const skill = join(pluginRoot, "skills", "demo-skill", "SKILL.md");
  mkdirSync(join(skill, ".."), { recursive: true });
  writeFileSync(
    skill,
    "---\nname: demo-skill\ndescription: Demo skill\n---\n\nDo the demo.\n",
  );
}

describe("marketplace manifest flavors", () => {
  it("reads a Copilot marketplace and classifies a spec plugin root", () => {
    const root = tempDir("ht-mkt-copilot-");
    writeSpecPlugin(root, "plugins/demo");
    writeJson(join(root, ".github/plugin/marketplace.json"), {
      name: "copilot-market",
      plugins: [{ name: "demo", source: "plugins/demo", description: "Demo plugin" }],
    });

    const plugins = listPluginsFromMarketplaceRoot(root, "copilot-market", ["claude-code"]);
    expect(plugins).toEqual([
      expect.objectContaining({
        name: "demo",
        sourcePath: "plugins/demo",
        packageFormat: "agent-plugin",
        ref: "demo@copilot-market",
      }),
    ]);

    const scanned = scanPluginSourceSync(join(root, ".github/plugin/marketplace.json"));
    expect(scanned).toHaveLength(1);
    expect(scanned[0]).toMatchObject({
      source_kind: "marketplace",
      plugin_name: "demo",
      metadata: { source_plugin_kind: "agent-plugin" },
    });
    expect(scanned[0]?.resources.some((resource) => resource.name === "demo-skill")).toBe(true);
  });

  it("reads a Codex marketplace source.path relative to the repo root", () => {
    const root = tempDir("ht-mkt-codex-");
    writeSpecPlugin(root, "plugins/demo");
    writeJson(join(root, ".agents/plugins/marketplace.json"), {
      name: "codex-market",
      plugins: [
        {
          name: "demo",
          source: { source: "local", path: "./plugins/demo" },
        },
      ],
    });

    const plugins = listPluginsFromMarketplaceRoot(root, "codex-market");
    expect(plugins[0]).toMatchObject({
      name: "demo",
      sourcePath: "plugins/demo",
      packageFormat: "agent-plugin",
    });

    const scanned = scanPluginSourceSync(join(root, ".agents/plugins/marketplace.json"));
    expect(scanned[0]?.metadata.source_plugin_kind).toBe("agent-plugin");
    expect(scanned[0]?.metadata.root_path).toBe(join(root, "plugins/demo"));
  });

  it("treats Codex source.path ./ as the repository root", () => {
    const root = tempDir("ht-mkt-codex-root-");
    writeSpecPlugin(root, ".");
    writeJson(join(root, ".agents/plugins/marketplace.json"), {
      name: "codex-root",
      plugins: [
        {
          name: "demo",
          source: { source: "local", path: "./" },
        },
      ],
    });

    const plugins = listPluginsFromMarketplaceRoot(root, "codex-root");
    expect(plugins[0]).toMatchObject({
      name: "demo",
      sourcePath: ".",
      packageFormat: "agent-plugin",
    });

    const scanned = scanPluginSourceSync(join(root, ".agents/plugins/marketplace.json"));
    expect(scanned[0]?.metadata.root_path).toBe(root);
    expect(scanned[0]?.metadata.source_plugin_kind).toBe("agent-plugin");
  });

  it("does not use a marketplace path that leaves the repo", () => {
    const parsed = parseCodexMarketplaceManifest({
      name: "codex-market",
      plugins: [
        {
          name: "demo",
          source: { source: "local", path: "../outside" },
        },
      ],
    });
    expect(parsed.plugins[0]?.sourcePath).toBe("../outside");

    const root = tempDir("ht-mkt-escape-");
    writeJson(join(root, ".agents/plugins/marketplace.json"), {
      name: "codex-market",
      plugins: [
        {
          name: "demo",
          source: { source: "local", path: "../outside" },
        },
      ],
    });
    expect(listPluginsFromMarketplaceRoot(root, "codex-market")).toEqual([]);
    expect(marketplaceRootWarnings(root, "codex-market")).toEqual([
      "Skipped demo: source path leaves the marketplace repository.",
    ]);
    expect(() =>
      scanPluginSourceSync(join(root, ".agents/plugins/marketplace.json")),
    ).toThrow(/Marketplace entry path must stay inside the marketplace/);
  });

  it("reads every manifest and labels each plugin with its flavor", () => {
    const root = tempDir("ht-mkt-dual-");
    writeSpecPlugin(root, "plugins/copilot-one");
    writeSpecPlugin(root, "plugins/codex-one");
    writeJson(join(root, ".github/plugin/marketplace.json"), {
      name: "dual",
      plugins: [{ name: "copilot-one", source: "plugins/copilot-one" }],
    });
    writeJson(join(root, ".agents/plugins/marketplace.json"), {
      name: "dual",
      plugins: [
        { name: "codex-one", source: { source: "local", path: "./plugins/codex-one" } },
        { name: "outside", source: { source: "local", path: "../outside" } },
      ],
    });

    const plugins = listPluginsFromMarketplaceRoot(root, "dual");
    expect(plugins.map((plugin) => ({ name: plugin.name, flavor: plugin.flavor }))).toEqual([
      { name: "copilot-one", flavor: "copilot-cli" },
      { name: "codex-one", flavor: "codex" },
    ]);
    expect(marketplaceRootWarnings(root, "dual")).toEqual([
      "Skipped outside: source path leaves the marketplace repository.",
    ]);
  });
});
