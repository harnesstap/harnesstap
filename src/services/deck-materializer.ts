import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DeckJson,
  DeckJsonEnvironment,
  Plugin,
  Resource,
} from "../types.js";
import { generateFiles, writeFiles } from "./applier.js";
import {
  getDedicatedSerializerPlatformIds,
} from "./platform-serializers.js";
import { PLUGIN_RESOURCE_TYPES } from "./resource-classification.js";

export interface MaterializeDeckPlugin {
  plugin: Plugin;
  resources: Resource[];
}

export interface MaterializeDeckRepoInput {
  deckJson: DeckJson;
  plugins: MaterializeDeckPlugin[];
  environments: DeckJsonEnvironment[];
  /** Platforms for per-plugin native file generation. */
  platforms?: string[];
}

interface ClaudePluginManifest {
  name: string;
  version?: string;
  description?: string;
  keywords?: string[];
  harnessdeck?: {
    needs: string[];
  };
}

interface MarketplacePluginEntry {
  name: string;
  source: string;
  version?: string;
}

interface MarketplaceManifest {
  name: string;
  plugins: MarketplacePluginEntry[];
}

const pluginResourceTypes = new Set<string>(PLUGIN_RESOURCE_TYPES);

/** Recursively sort object keys for deterministic JSON output (deck doctor diffs). */
export function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted as T;
  }
  return value;
}

export function stableJsonStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function writeDeterministicJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stableJsonStringify(value), "utf-8");
}

function filterPluginResources(resources: Resource[]): Resource[] {
  return resources.filter((resource) => pluginResourceTypes.has(resource.type));
}

function buildPluginManifest(plugin: Plugin): ClaudePluginManifest {
  const manifest: ClaudePluginManifest = {
    name: plugin.name,
    version: plugin.version,
  };
  if (plugin.description) {
    manifest.description = plugin.description;
  }
  if (plugin.tags.length > 0) {
    manifest.keywords = [...plugin.tags].sort();
  }
  if (plugin.needs && plugin.needs.length > 0) {
    manifest.harnessdeck = {
      needs: [...plugin.needs].sort(),
    };
  }
  return manifest;
}

function buildMarketplaceManifest(
  deckJson: DeckJson,
  plugins: MaterializeDeckPlugin[],
): MarketplaceManifest {
  const entries: MarketplacePluginEntry[] = [...plugins]
    .sort((a, b) => a.plugin.name.localeCompare(b.plugin.name))
    .map(({ plugin }) => ({
      name: plugin.name,
      source: `./${plugin.name}`,
      version: plugin.version,
    }));

  return {
    name: deckJson.name,
    plugins: entries,
  };
}

function buildEnvironmentFile(env: DeckJsonEnvironment): DeckJsonEnvironment {
  const file: DeckJsonEnvironment = {
    name: env.name,
    values: sortKeysDeep(env.values ?? {}),
  };
  if (env.secret_refs && Object.keys(env.secret_refs).length > 0) {
    file.secret_refs = sortKeysDeep(env.secret_refs);
  }
  return file;
}

async function materializePluginNativeFiles(
  pluginDir: string,
  resources: Resource[],
  platforms: string[],
): Promise<void> {
  const pluginResources = filterPluginResources(resources);
  if (pluginResources.length === 0) return;

  const results = await generateFiles(pluginResources, platforms, pluginDir);
  for (const result of results) {
    writeFiles(result.files, pluginDir);
  }
}

/**
 * Write a hybrid deck repo: canonical `.harnessdeck/` tree plus generated Claude
 * marketplace manifests and per-plugin native harness files.
 */
export async function materializeDeckRepo(
  input: MaterializeDeckRepoInput,
  outDir: string,
): Promise<void> {
  const platforms =
    input.platforms ?? getDedicatedSerializerPlatformIds();

  writeDeterministicJson(
    join(outDir, ".harnessdeck", "deck.json"),
    input.deckJson,
  );

  for (const env of [...input.environments].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    writeDeterministicJson(
      join(outDir, ".harnessdeck", "environments", `${env.name}.json`),
      buildEnvironmentFile(env),
    );
  }

  for (const { plugin, resources } of input.plugins) {
    const pluginDir = join(outDir, plugin.name);
    writeDeterministicJson(
      join(pluginDir, ".claude-plugin", "plugin.json"),
      buildPluginManifest(plugin),
    );
    await materializePluginNativeFiles(pluginDir, resources, platforms);
  }

  writeDeterministicJson(
    join(outDir, ".claude-plugin", "marketplace.json"),
    buildMarketplaceManifest(input.deckJson, input.plugins),
  );
}
