import type { LayerExport, LayerExportEntry, LayerExportResource } from "../../src/types.ts";
import { formatLayerExportToml, parseLayerExportToml } from "../../src/services/transport/layer.ts";
import { formatDeckToml, parseDeckToml } from "../../src/services/transport/deck.ts";
import type { DeckJson } from "../../src/types.ts";
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
  plugins?: LayerExportEntry["plugins"];
  dependencies?: LayerExportEntry["dependencies"];
  claude?: LayerExportEntry["claude"];
  org?: string;
  catalog?: string;
}): LayerExport {
  return {
    $schema: "urn:harnessdeck:layer:v1",
    version: 1,
    layer: {
      name: input.name,
      version: input.version ?? "1.0.0",
      description: input.description ?? "",
      tags: input.tags ?? [],
      ...(input.org ? { org_slug: input.org } : {}),
      ...(input.catalog ? { catalog_slug: input.catalog } : {}),
    },
    resources: input.resources ?? [],
    plugins: input.plugins ?? [],
    embedded_plugins: [],
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    ...(input.claude ? { claude: input.claude } : {}),
  };
}

export function makeMultiLayerExport(
  layers: Array<{
    name: string;
    version?: string;
    description?: string;
    tags?: string[];
    resources?: LayerExportResource[];
    plugins?: LayerExportEntry["plugins"];
  }>,
): LayerExport {
  return {
    $schema: "urn:harnessdeck:layer:v1",
    version: 1,
    layers: layers.map((layer) => ({
      name: layer.name,
      version: layer.version ?? "1.0.0",
      description: layer.description ?? "",
      tags: layer.tags ?? [],
      resources: layer.resources ?? [],
      plugins: layer.plugins ?? [],
    })),
    embedded_plugins: [],
  };
}

export function formatTestDeckToml(deck: DeckJson): string {
  return formatDeckToml(deck);
}

export function parseTestDeckToml(raw: string): DeckJson {
  return parseDeckToml(raw);
}

export function writeDeckToml(path: string, deck: DeckJson): void {
  writeTextFile(path, formatDeckToml(deck));
}
