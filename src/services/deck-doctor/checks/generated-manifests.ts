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

function buildMaterializeInput(context: DeckDoctorContext): MaterializeDeckRepoInput {
  const pluginVersions = new Map<string, string>();
  for (const layer of context.deckJson.layers) {
    for (const ref of layer.plugins) {
      if (!pluginVersions.has(ref.name)) {
        pluginVersions.set(ref.name, ref.version);
      }
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

function collectPluginManifestPaths(deckJson: DeckDoctorContext["deckJson"]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const layer of deckJson.layers) {
    for (const plugin of layer.plugins) {
      if (seen.has(plugin.name)) {
        continue;
      }
      seen.add(plugin.name);
      paths.push(`${plugin.name}/.claude-plugin/plugin.json`);
    }
  }
  return paths.sort();
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
      fix: `Remove ${relativePath} or update .harnessdeck/deck.json`,
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
      detail: `Expected output from .harnessdeck/deck.json does not match ${relativePath}`,
      fix: `Run deck materialize to refresh ${relativePath}`,
    };
  }

  return null;
}

export const generatedManifestsCheck = {
  id: "generated-manifests",
  description:
    "Compare generated Claude manifests and HarnessDeck-owned files against .harnessdeck/deck.json",
  async run(context: DeckDoctorContext): Promise<DeckDoctorCheckResult[]> {
    const tempDir = mkdtempSync(join(tmpdir(), "harnessdeck-deck-doctor-"));

    try {
      await materializeDeckRepo(buildMaterializeInput(context), tempDir);

      const relativePaths = [
        ...GENERATED_MANIFEST_PATHS,
        ...collectPluginManifestPaths(context.deckJson),
      ];

      return relativePaths
        .map((relativePath) => compareGeneratedFile(context.repoRoot, tempDir, relativePath))
        .filter((result): result is DeckDoctorCheckResult => result !== null);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
};
