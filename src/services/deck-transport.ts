import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDeck, getDeckByName } from "../models/deck.js";
import {
  getLayerByPublishedIdentity,
  resolveLayerSelector,
} from "../models/layer-model.js";
import { stableJsonStringify } from "./deck-materializer.js";
import {
  exportDeckToDeckJson,
  exportToFile,
  importDeckJson,
  importFromFile,
  type ImportDeckJsonResult,
} from "./exporter.js";
import type { DeckJsonLayer } from "../types.js";

export interface ExportDeckRepoOptions {
  /** Write layer v1 files under `.harnessdeck/layers/` for portable round-trip. */
  withLayerBundles?: boolean;
}

export interface ImportDeckRepoOptions {
  deckNameOverride?: string;
  resourceSource?: string;
}

function layerBundleFileName(layer: DeckJsonLayer): string {
  return `${layer.name}@${layer.version}.harnessdeck.jsonc`;
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
): { deckJsonPath: string; layerBundlePaths: string[] } {
  const deck = resolveDeck(deckSelector);
  const resolvedOutput = resolve(outputDir);
  const harnessdeckDir = join(resolvedOutput, ".harnessdeck");
  mkdirSync(harnessdeckDir, { recursive: true });

  const deckJson = exportDeckToDeckJson(deck.id);
  const deckJsonPath = join(harnessdeckDir, "deck.json");
  writeFileSync(deckJsonPath, stableJsonStringify(deckJson), "utf-8");

  mkdirSync(join(harnessdeckDir, "environments"), { recursive: true });
  for (const environment of deckJson.environments) {
    const envPath = join(harnessdeckDir, "environments", `${environment.name}.json`);
    writeFileSync(envPath, stableJsonStringify(environment), "utf-8");
  }

  const layerBundlePaths: string[] = [];
  if (options.withLayerBundles) {
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
      const bundlePath = join(layersDir, layerBundleFileName(layerEntry));
      exportToFile(localLayer.id, bundlePath);
      layerBundlePaths.push(bundlePath);
    }
  }

  return { deckJsonPath, layerBundlePaths };
}

function importMissingLayerBundles(repoRoot: string, deckJsonPath: string): void {
  const layersDir = join(repoRoot, ".harnessdeck", "layers");
  if (!existsSync(layersDir)) {
    return;
  }

  const deckJson = JSON.parse(readFileSync(deckJsonPath, "utf-8")) as {
    layers: DeckJsonLayer[];
  };

  for (const layerEntry of deckJson.layers) {
    const selector = layerEntry.org && layerEntry.catalog
      ? `${layerEntry.org}/${layerEntry.catalog}/${layerEntry.name}@${layerEntry.version}`
      : `${layerEntry.name}@${layerEntry.version}`;
    if (resolveLayerSelector(selector)) {
      continue;
    }

    const bundlePath = join(layersDir, layerBundleFileName(layerEntry));
    if (!existsSync(bundlePath)) {
      throw new Error(
        `Layer ${layerEntry.name}@${layerEntry.version} is not installed locally and no bundle was found at ${bundlePath}`,
      );
    }
    importFromFile(bundlePath, { resourceSource: "import:deck-repo" });
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
  const deckJsonPath = join(resolvedRoot, ".harnessdeck", "deck.json");
  if (!existsSync(deckJsonPath)) {
    throw new Error(`Deck repo missing canonical source: ${deckJsonPath}`);
  }

  importMissingLayerBundles(resolvedRoot, deckJsonPath);

  return importDeckJson(deckJsonPath, {
    deckNameOverride: options.deckNameOverride,
    rootPath: resolvedRoot,
    resourceSource: options.resourceSource ?? "import:deck-repo",
  });
}
