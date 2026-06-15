import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "../../../types.js";
import {
  materializeDeckRepo,
  sortKeysDeep,
  type MaterializeDeckPlugin,
  type MaterializeDeckRepoInput,
} from "../../deck-materializer.js";
import type { DeckDoctorCheckResult, DeckDoctorContext } from "../deck-doctor.types.js";

const GENERATED_MANIFEST_PATHS = [".claude-plugin/marketplace.json"] as const;

interface RepoPluginManifest {
  description?: string;
  keywords?: string[];
  harnessdeck?: { needs?: string[] };
}

function readRepoPluginManifest(
  repoRoot: string,
  pluginName: string,
): RepoPluginManifest | undefined {
  const manifestPath = join(repoRoot, pluginName, ".claude-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, "utf-8")) as RepoPluginManifest;
  } catch {
    return undefined;
  }
}

function readMarketplacePluginRefs(
  repoRoot: string,
): Array<{ name: string; version: string }> {
  const marketplacePath = join(repoRoot, ".claude-plugin", "marketplace.json");
  if (!existsSync(marketplacePath)) {
    return [];
  }

  try {
    const manifest = JSON.parse(readFileSync(marketplacePath, "utf-8")) as {
      plugins?: Array<{ name?: string; version?: string }>;
    };
    return (manifest.plugins ?? [])
      .filter((entry): entry is { name: string; version?: string } =>
        typeof entry.name === "string",
      )
      .map((entry) => ({
        name: entry.name,
        version: entry.version ?? "1.0.0",
      }));
  } catch {
    return [];
  }
}

function collectDeckJsonPluginRefs(
  context: DeckDoctorContext,
): Array<{ name: string; version: string }> {
  const refs: Array<{ name: string; version: string }> = [];
  const seen = new Set<string>();

  for (const layer of context.deckJson.layers) {
    const layerRefs =
      layer.plugins && layer.plugins.length > 0
        ? layer.plugins
        : [{ name: layer.name, version: layer.version }];
    for (const ref of layerRefs) {
      if (seen.has(ref.name)) {
        continue;
      }
      seen.add(ref.name);
      refs.push(ref);
    }
  }

  if (refs.length === 0) {
    for (const ref of readMarketplacePluginRefs(context.repoRoot)) {
      if (seen.has(ref.name)) {
        continue;
      }
      seen.add(ref.name);
      refs.push(ref);
    }
  }

  return refs;
}

function buildMaterializeInput(context: DeckDoctorContext): MaterializeDeckRepoInput {
  const pluginVersions = new Map<string, string>();
  for (const ref of collectDeckJsonPluginRefs(context)) {
    if (!pluginVersions.has(ref.name)) {
      pluginVersions.set(ref.name, ref.version);
    }
  }

  const plugins: MaterializeDeckPlugin[] = [...pluginVersions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => {
      const manifest = readRepoPluginManifest(context.repoRoot, name);
      const plugin: Plugin = {
        id: name,
        name,
        version,
        org_slug: "",
        catalog_slug: "",
        description: manifest?.description ?? "",
        tags: manifest?.keywords ?? [],
        created_at: "1970-01-01T00:00:00.000Z",
        updated_at: "1970-01-01T00:00:00.000Z",
      };
      if (manifest?.harnessdeck?.needs?.length) {
        plugin.needs = [...manifest.harnessdeck.needs].sort();
      }
      return { plugin, resources: [] };
    });

  return {
    deckJson: context.deckJson,
    environments: context.deckJson.environments,
    plugins,
    platforms: [],
  };
}

function collectPluginManifestPaths(context: DeckDoctorContext): string[] {
  return collectDeckJsonPluginRefs(context)
    .map((plugin) => `${plugin.name}/.claude-plugin/plugin.json`)
    .sort();
}

function readNormalizedJson(filePath: string): unknown | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return sortKeysDeep(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return null;
  }
}

function compareGeneratedFile(
  repoRoot: string,
  generatedRoot: string,
  relativePath: string,
): DeckDoctorCheckResult | null {
  const expected = readNormalizedJson(join(generatedRoot, relativePath));
  const actual = readNormalizedJson(join(repoRoot, relativePath));

  if (expected === null && actual === null) {
    return null;
  }

  if (expected === null) {
    return {
      severity: "error",
      message: `Unexpected generated file on disk: ${relativePath}`,
      fix: `Remove ${relativePath} or update .harnessdeck/deck.toml`,
    };
  }

  if (actual === null) {
    return {
      severity: "error",
      message: `Missing generated file: ${relativePath}`,
      fix: `Run deck materialize to regenerate ${relativePath}`,
    };
  }

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    return {
      severity: "error",
      message: `Generated manifest drift: ${relativePath}`,
      detail: `Expected output from .harnessdeck/deck.toml does not match ${relativePath}`,
      fix: `Run deck materialize to refresh ${relativePath}`,
    };
  }

  return null;
}

export const generatedManifestsCheck = {
  id: "generated-manifests",
  description:
    "Compare generated Claude manifests and HarnessDeck-owned files against .harnessdeck/deck.toml",
  async run(context: DeckDoctorContext): Promise<DeckDoctorCheckResult[]> {
    const tempDir = mkdtempSync(join(tmpdir(), "harnessdeck-deck-doctor-"));

    try {
      await materializeDeckRepo(buildMaterializeInput(context), tempDir);

      const relativePaths = [
        ...GENERATED_MANIFEST_PATHS,
        ...collectPluginManifestPaths(context),
      ];

      return relativePaths
        .map((relativePath) => compareGeneratedFile(context.repoRoot, tempDir, relativePath))
        .filter((result): result is DeckDoctorCheckResult => result !== null);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
};
