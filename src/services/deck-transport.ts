import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDeck, getDeckByName } from "../models/deck.js";
import {
  getLayerByPublishedIdentity,
  resolveLayerSelector,
} from "../models/layer-model.js";
import {
  exportDeckToDeckJson,
  exportToFile,
  importDeckToml,
  importFromFile,
  readDeckToml,
  type ImportDeckJsonResult,
} from "./exporter.js";
import { formatDeckToml } from "./transport/index.js";
import type { DeckJsonLayer } from "../types.js";

export interface ExportDeckRepoOptions {
  /** Write layer v1 files under `.harnessdeck/layers/` for portable round-trip. */
  withLayerExports?: boolean;
}

export interface ImportDeckRepoOptions {
  deckNameOverride?: string;
  resourceSource?: string;
}

function layerExportFileName(layer: DeckJsonLayer): string {
  return `${layer.name}@${layer.version}.harnessdeck.toml`;
}

function resolveDeck(deckSelector: string) {
  const deck = getDeck(deckSelector) ?? getDeckByName(deckSelector);
  if (!deck) {
    throw new Error(`Deck not found: ${deckSelector}`);
  }
  return deck;
}

/**
 * Export a deck database record to a portable hybrid deck repo directory.
 */
export function exportDeckRepo(
  deckSelector: string,
  outputDir: string,
  options: ExportDeckRepoOptions = {},
): { deckTomlPath: string; layerExportPaths: string[] } {
  const deck = resolveDeck(deckSelector);
  const resolvedOutput = resolve(outputDir);
  const harnessdeckDir = join(resolvedOutput, ".harnessdeck");
  mkdirSync(harnessdeckDir, { recursive: true });

  const deckJson = exportDeckToDeckJson(deck.id);
  const deckTomlPath = join(harnessdeckDir, "deck.toml");
  writeFileSync(deckTomlPath, formatDeckToml(deckJson), "utf-8");

  const layerExportPaths: string[] = [];
  if (options.withLayerExports) {
    const layersDir = join(harnessdeckDir, "layers");
    mkdirSync(layersDir, { recursive: true });
    for (const layerEntry of deckJson.layers) {
      const localLayer =
        getLayerByPublishedIdentity({
          name: layerEntry.name,
          version: layerEntry.version,
          org: layerEntry.org,
          catalog: layerEntry.catalog,
        }) ?? resolveLayerSelector(`${layerEntry.name}@${layerEntry.version}`);
      if (!localLayer) {
        throw new Error(
          `Cannot export layer export for missing local layer: ${layerEntry.name}@${layerEntry.version}`,
        );
      }
      const layerExportPath = join(layersDir, layerExportFileName(layerEntry));
      exportToFile(localLayer.id, layerExportPath);
      layerExportPaths.push(layerExportPath);
    }
  }

  return { deckTomlPath, layerExportPaths };
}

function importMissingLayerExports(repoRoot: string, deckTomlPath: string): void {
  const layersDir = join(repoRoot, ".harnessdeck", "layers");
  if (!existsSync(layersDir)) {
    return;
  }

  const deckJson = readDeckToml(deckTomlPath);

  for (const layerEntry of deckJson.layers) {
    const selector = layerEntry.org && layerEntry.catalog
      ? `${layerEntry.org}/${layerEntry.catalog}/${layerEntry.name}@${layerEntry.version}`
      : `${layerEntry.name}@${layerEntry.version}`;
    if (resolveLayerSelector(selector)) {
      continue;
    }

    const layerExportPath = join(layersDir, layerExportFileName(layerEntry));
    if (!existsSync(layerExportPath)) {
      throw new Error(
        `Layer ${layerEntry.name}@${layerEntry.version} is not installed locally and no layer export was found at ${layerExportPath}`,
      );
    }
    importFromFile(layerExportPath, { resourceSource: "import:deck-repo" });
  }
}

/**
 * Import a hybrid deck repo directory into the local database.
 */
export function importDeckRepo(
  repoRoot: string,
  options: ImportDeckRepoOptions = {},
): ImportDeckJsonResult {
  const resolvedRoot = resolve(repoRoot);
  const deckTomlPath = join(resolvedRoot, ".harnessdeck", "deck.toml");
  if (!existsSync(deckTomlPath)) {
    throw new Error(`Deck repo missing canonical source: ${deckTomlPath}`);
  }

  importMissingLayerExports(resolvedRoot, deckTomlPath);

  return importDeckToml(deckTomlPath, {
    deckNameOverride: options.deckNameOverride,
    rootPath: resolvedRoot,
    resourceSource: options.resourceSource ?? "import:deck-repo",
  });
}
