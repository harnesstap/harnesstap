import type { LayerExport, LayerExportEntry, LayerExportResource } from "../../src/types.ts";
import { formatLayerExportToml, parseLayerExportToml } from "../../src/services/transport/layer.ts";
import { writeTextFile } from "./fs.ts";

export function formatTestLayerToml(bundle: LayerExport): string {
  return formatLayerExportToml(bundle);
}

export function parseTestLayerToml(raw: string) {
  return parseLayerExportToml(raw);
}

export function writeLayerExportToml(path: string, bundle: LayerExport): void {
  writeTextFile(path, formatLayerExportToml(bundle));
}

export function makeSingleLayerExport(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  resources?: LayerExportResource[];
  plugin_pins?: LayerExportEntry["plugin_pins"];
  dependencies?: LayerExportEntry["dependencies"];
  claude?: LayerExportEntry["claude"];
  org?: string;
  catalog?: string;
}): LayerExport {
  return {
    $schema: "urn:harnesstap:layer:v1",
    version: 1,
    layers: [
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

export function makeMultiLayerExport(
  layers: Array<{
    name: string;
    version?: string;
    description?: string;
    tags?: string[];
    resources?: LayerExportResource[];
    plugin_pins?: LayerExportEntry["plugin_pins"];
  }>,
): LayerExport {
  return {
    $schema: "urn:harnesstap:layer:v1",
    version: 1,
    layers: layers.map((layer) => ({
      name: layer.name,
      version: layer.version ?? "1.0.0",
      description: layer.description ?? "",
      tags: layer.tags ?? [],
      resources: layer.resources ?? [],
      plugin_pins: layer.plugin_pins ?? [],
    })),
    embedded_plugins: [],
  };
}
