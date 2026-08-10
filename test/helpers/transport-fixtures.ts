import type { PluginExport, PluginExportEntry, PluginExportResource } from "../../src/types.ts";
import { formatPluginExportToml, parsePluginExportToml } from "../../src/services/transport/plugin.ts";
import { writeTextFile } from "./fs.ts";

export function formatTestPluginToml(bundle: PluginExport): string {
  return formatPluginExportToml(bundle);
}

export function parseTestPluginToml(raw: string) {
  return parsePluginExportToml(raw);
}

export function writePluginExportToml(path: string, bundle: PluginExport): void {
  writeTextFile(path, formatPluginExportToml(bundle));
}

export function makeSinglePluginExport(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  resources?: PluginExportResource[];
  plugin_pins?: PluginExportEntry["plugin_pins"];
  dependencies?: PluginExportEntry["dependencies"];
  claude?: PluginExportEntry["claude"];
  org?: string;
  catalog?: string;
}): PluginExport {
  return {
    $schema: "urn:harnesstap:layer:v1",
    version: 1,
    plugins: [
      {
        name: input.name,
        version: input.version ?? "1.0.0",
        description: input.description ?? "",
        tags: input.tags ?? [],
        resources: input.resources ?? [],
        plugin_pins: input.plugin_pins ?? [],
        ...(input.org ? { org_slug: input.org } : {}),
        ...(input.catalog ? { catalog_slug: input.catalog } : {}),
        ...(input.dependencies ? { dependencies: input.dependencies } : {}),
        ...(input.claude ? { claude: input.claude } : {}),
      },
    ],
    embedded_plugins: [],
  };
}

export function makeMultiPluginExport(
  plugins: Array<{
    name: string;
    version?: string;
    description?: string;
    tags?: string[];
    resources?: PluginExportResource[];
    plugin_pins?: PluginExportEntry["plugin_pins"];
  }>,
): PluginExport {
  return {
    $schema: "urn:harnesstap:layer:v1",
    version: 1,
    plugins: plugins.map((plugin) => ({
      name: plugin.name,
      version: plugin.version ?? "1.0.0",
      description: plugin.description ?? "",
      tags: plugin.tags ?? [],
      resources: plugin.resources ?? [],
      plugin_pins: plugin.plugin_pins ?? [],
    })),
    embedded_plugins: [],
  };
}
