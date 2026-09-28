import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResourceCreateInput } from "../types.js";
import type { ApplyResult } from "./applier.js";
import type { SkillHubPlan } from "./host-plugin-material.js";
import type { ExtractHostPluginMaterialResult } from "./host-plugin-material.js";
import { getPlatformSerializer } from "./platform-serializers.js";
import { resourceIdentity } from "./reference-resources.js";
import type { SerializerTarget, SerializeOptions } from "../types.js";
import { toPortableEmitResources } from "./harness-resource-union.js";
import {
  PLUGIN_TRANSLATION_SCHEMA,
  type PluginTranslationMarkerEntry,
  type PluginTranslationMarkerFile,
} from "./plugin-translation-source.js";

function resolveConfiguredPath(rootPath: string, configuredPath: string): string {
  return configuredPath.startsWith("~/")
    ? join(rootPath, configuredPath.slice(2))
    : join(rootPath, configuredPath);
}

export {
  PLUGIN_TRANSLATION_SCHEMA,
  type PluginTranslationMarkerEntry,
  type PluginTranslationMarkerFile,
  type PluginTranslationSource,
  pluginTranslationSourceFromPin,
} from "./plugin-translation-source.js";

function parseMarkerFile(raw: string): PluginTranslationMarkerFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PluginTranslationMarkerFile>;
    if (parsed.schema !== PLUGIN_TRANSLATION_SCHEMA) return null;
    if (!Array.isArray(parsed.entries)) return null;
    return {
      schema: PLUGIN_TRANSLATION_SCHEMA,
      entries: parsed.entries.filter(
        (entry): entry is PluginTranslationMarkerEntry =>
          typeof entry === "object"
          && entry !== null
          && typeof entry.type === "string"
          && typeof entry.name === "string"
          && typeof entry.plugin === "string"
          && typeof entry.marketplace === "string"
          && typeof entry.origin_ref === "string",
      ),
    };
  } catch {
    return null;
  }
}

export function readPluginTranslationMarker(
  markerPath: string,
): PluginTranslationMarkerFile | null {
  if (!existsSync(markerPath)) return null;
  return parseMarkerFile(readFileSync(markerPath, "utf8"));
}

function entryKey(entry: Pick<PluginTranslationMarkerEntry, "type" | "name">): string {
  return `${entry.type}:${entry.name}`;
}

function writeMarkerFile(markerPath: string, entries: PluginTranslationMarkerEntry[]): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  const file: PluginTranslationMarkerFile = {
    schema: PLUGIN_TRANSLATION_SCHEMA,
    entries,
  };
  writeFileSync(markerPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

/** Skill directories get an exclusive marker; shared parent dirs merge entries. */
export function writePluginTranslationMarker(
  markerDirectory: string,
  entry: PluginTranslationMarkerEntry,
  options?: { exclusive?: boolean },
): void {
  const markerPath = join(markerDirectory, ".harnesstap");
  if (options?.exclusive) {
    writeMarkerFile(markerPath, [entry]);
    return;
  }
  const existing = readPluginTranslationMarker(markerPath);
  const byKey = new Map<string, PluginTranslationMarkerEntry>();
  for (const prior of existing?.entries ?? []) {
    byKey.set(entryKey(prior), prior);
  }
  byKey.set(entryKey(entry), entry);
  writeMarkerFile(markerPath, [...byKey.values()]);
}

function markerDirectoryForSource(
  rootPath: string,
  resource: Pick<ResourceCreateInput, "type" | "source">,
): string | null {
  const source = resource.source?.trim();
  if (!source) return null;
  const absolute = resolveConfiguredPath(rootPath, source);
  if (resource.type === "skill") {
    const normalized = source.replace(/\\/g, "/");
    if (normalized.endsWith("/SKILL.md") || normalized.endsWith("SKILL.md")) {
      return dirname(absolute);
    }
    return absolute;
  }
  return dirname(absolute);
}

function resourceMatchesMarkerEntry(
  resource: Pick<ResourceCreateInput, "type" | "name">,
  entry: PluginTranslationMarkerEntry,
): boolean {
  return entry.type === resource.type && entry.name === resource.name;
}

export function isPluginTranslatedResource(
  rootPath: string,
  resource: ResourceCreateInput,
): boolean {
  const markerDir = markerDirectoryForSource(rootPath, resource);
  if (!markerDir) return false;
  const marker = readPluginTranslationMarker(join(markerDir, ".harnesstap"));
  if (!marker) return false;
  return marker.entries.some((entry) => resourceMatchesMarkerEntry(resource, entry));
}

export function dropPluginTranslatedResources(
  rootPath: string,
  resources: readonly ResourceCreateInput[],
): ResourceCreateInput[] {
  return resources.filter((resource) => !isPluginTranslatedResource(rootPath, resource));
}

export async function writeHarnessSyncPluginTranslationMarkers(input: {
  rootPath: string;
  extracted: ExtractHostPluginMaterialResult;
  skillHubPlans: readonly SkillHubPlan[];
  extraResults: readonly ApplyResult[];
  portablePlatforms: readonly string[];
  target: SerializerTarget;
  serializeOptions?: Omit<SerializeOptions, "target">;
}): Promise<void> {
  const skillPluginByName = new Map(
    input.extracted.skills.map((skill) => [skill.name, skill.plugin]),
  );

  for (const plan of input.skillHubPlans) {
    const skillName = plan.destDir.replace(/\\/g, "/").split("/").pop() ?? "";
    const plugin = skillPluginByName.get(skillName);
    if (!plugin || !skillName) continue;
    writePluginTranslationMarker(join(input.rootPath, plan.destDir), {
      ...plugin,
      type: "skill",
      name: skillName,
    }, { exclusive: true });
  }

  const serializedPaths = new Set<string>();
  for (const result of input.extraResults) {
    for (const file of result.files) {
      serializedPaths.add(file.path.replace(/\\/g, "/"));
    }
  }

  for (const resource of input.extracted.resources) {
    const plugin = input.extracted.resourcePlugins.get(resourceIdentity(resource));
    if (!plugin) continue;
    const portable = toPortableEmitResources([resource]);
    for (const platformId of input.portablePlatforms) {
      const serializer = getPlatformSerializer(platformId);
      const files = await serializer.serialize(
        portable,
        input.rootPath,
        { target: input.target, ...input.serializeOptions },
      );
      for (const file of files) {
        const relative = file.path.replace(/\\/g, "/");
        if (!serializedPaths.has(relative)) continue;
        const absolute = join(input.rootPath, relative);
        const markerDir = relative.endsWith("/SKILL.md")
          ? dirname(absolute)
          : dirname(absolute);
        writePluginTranslationMarker(markerDir, {
          ...plugin,
          type: resource.type,
          name: resource.name,
        }, { exclusive: relative.endsWith("/SKILL.md") });
      }
    }
  }
}
