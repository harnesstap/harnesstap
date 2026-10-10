import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPlatform } from "../platforms/registry.js";
import type { Resource, ResourceCreateInput, SerializerTarget } from "../types.js";
import { hostPluginPinIsInstalled } from "./host-native-mcp.js";
import {
  type HostPluginLayout,
  isHostPluginPinResource,
} from "./host-plugin-serialize.js";
import { materializeFromSource } from "./link-materialize.js";
import type { PluginResourceMode } from "./plugin-resource-mode.js";
import { scanPluginSourceForMerge } from "./plugin-source-import.js";
import { resourceIdentity } from "./reference-resources.js";
import { resolveInstallRoot } from "./resource-sync.js";
import {
  normalizeSkillDir,
  skillConsumeDirs,
} from "./shared-emit-paths.js";
import {
  type PluginTranslationSource,
  pluginTranslationSourceFromPin,
} from "./plugin-translation-source.js";

export const HOST_PLUGIN_TREE_PLATFORMS: ReadonlySet<HostPluginLayout> = new Set([
  "claude-code",
  "cursor",
]);

export function isHostPluginTreePlatform(id: string): id is HostPluginLayout {
  return id === "claude-code" || id === "cursor";
}

export function portableHarnessesForPluginFanout(
  platforms: readonly string[],
): string[] {
  return platforms.filter((id) => !isHostPluginTreePlatform(id));
}

const HOST_PLUGIN_BUNDLED_TYPES = new Set(["skill", "command", "agent", "hook"]);

function importedFromPluginName(
  resource: Pick<Resource, "metadata">,
): string | undefined {
  const imported = (resource.metadata as { imported_from?: { plugin_name?: unknown } } | undefined)
    ?.imported_from;
  if (typeof imported?.plugin_name === "string" && imported.plugin_name.trim()) {
    return imported.plugin_name.trim();
  }
  return undefined;
}

function isHostPluginBundledMaterial(
  resource: Pick<Resource, "type" | "name" | "origin_kind" | "origin_ref" | "metadata">,
  pins: ReadonlySet<string>,
  pinNames: ReadonlySet<string>,
  homeRoot: string,
): boolean {
  if (!HOST_PLUGIN_BUNDLED_TYPES.has(resource.type)) {
    return false;
  }
  const originRef = resource.origin_ref?.trim() ?? "";
  if (originRef && pins.has(originRef)) {
    return true;
  }
  const pluginName = importedFromPluginName(resource);
  if (pluginName && pinNames.has(pluginName)) {
    return true;
  }
  if (pins.has(`${resource.name}@local`) || pins.has(resource.name)) {
    return (
      resource.origin_kind === "marketplace_link"
      || resource.origin_kind === "local_snapshot"
    );
  }
  if (
    resource.origin_kind === "marketplace_link"
    && originRef.includes("@")
    && hostPluginPinIsInstalled(homeRoot, originRef)
  ) {
    return true;
  }
  return false;
}

/**
 * Cursor and Claude Code load marketplace plugins from the host plugin tree.
 * Do not also serialize those bundled skills as standalone `skills/` dirs.
 * Portable harnesses (OpenCode, Codex, ...) still receive them as skills.
 */
export function omitHostPluginBundledSkills(
  resources: readonly Resource[],
  platformId: string,
  homeRoot: string,
  _target: SerializerTarget = "project",
): Resource[] {
  if (!isHostPluginTreePlatform(platformId)) {
    return [...resources];
  }
  const pinResources = resources.filter((resource) => isHostPluginPinResource(resource));
  if (pinResources.length === 0) {
    return [...resources];
  }
  const pins = new Set(
    pinResources.map((resource) => resource.origin_ref || resource.name),
  );
  const pinNames = new Set(pinResources.map((resource) => resource.name));
  return resources.filter(
    (resource) => !isHostPluginBundledMaterial(resource, pins, pinNames, homeRoot),
  );
}

export interface ExtractedPluginSkill {
  name: string;
  sourceDir: string;
  plugin: PluginTranslationSource;
}

export interface ExtractHostPluginMaterialResult {
  skills: ExtractedPluginSkill[];
  resources: ResourceCreateInput[];
  resourcePlugins: Map<string, PluginTranslationSource>;
}

function isHostPluginPinInput(
  resource: ResourceCreateInput,
): boolean {
  return isHostPluginPinResource({
    type: resource.type,
    metadata: resource.metadata,
    origin_ref: resource.origin_ref ?? "",
  });
}

function skillSourceDir(
  installRoot: string,
  resource: ResourceCreateInput,
): string | undefined {
  const relative = resource.source.replace(/\\/g, "/");
  const dir = join(installRoot, dirname(relative));
  if (!existsSync(join(dir, "SKILL.md"))) return undefined;
  return dir;
}

/**
 * Pull skills and other material out of Claude/Cursor host plugin install trees
 * so harnesses that do not load those trees (OpenCode, Codex, …) can use them.
 */
export async function extractHostPluginMaterial(
  pins: readonly ResourceCreateInput[],
  homeRoot: string,
  occupiedIdentities: ReadonlySet<string> = new Set(),
): Promise<ExtractHostPluginMaterialResult> {
  const skills: ExtractedPluginSkill[] = [];
  const resources: ResourceCreateInput[] = [];
  const resourcePlugins = new Map<string, PluginTranslationSource>();
  const seenSkills = new Set<string>();
  const seenIdentities = new Set<string>(occupiedIdentities);

  for (const identity of occupiedIdentities) {
    if (identity.startsWith("skill:")) {
      const name = identity.slice("skill:".length).split(":")[0];
      if (name) seenSkills.add(name);
    }
  }

  for (const pin of pins) {
    if (!isHostPluginPinInput(pin)) continue;
    const originRef = pin.origin_ref;
    if (!originRef) continue;
    const installRoot = resolveInstallRoot(originRef, homeRoot);
    if (!installRoot || !existsSync(installRoot)) continue;
    const pluginSource = pluginTranslationSourceFromPin(pin);
    if (!pluginSource) continue;

    const scans = await scanPluginSourceForMerge(installRoot);
    for (const scan of scans) {
      for (const resource of scan.resources) {
        if (resource.type === "skill") {
          if (seenSkills.has(resource.name)) continue;
          const sourceDir = skillSourceDir(installRoot, resource);
          if (!sourceDir) continue;
          seenSkills.add(resource.name);
          skills.push({ name: resource.name, sourceDir, plugin: pluginSource });
          continue;
        }
        const identity = resourceIdentity(resource);
        if (seenIdentities.has(identity)) continue;
        seenIdentities.add(identity);
        resources.push(resource);
        resourcePlugins.set(identity, pluginSource);
      }
    }
  }

  return { skills, resources, resourcePlugins };
}

export function agentsSkillHubPrefix(): string {
  return ".agents/skills/";
}

export function nativeSkillDir(
  platformId: string,
  target: SerializerTarget,
): string | undefined {
  const platform = getPlatform(platformId);
  if (!platform) return undefined;
  const raw =
    target === "global"
      ? platform.globalPaths.skills
      : platform.projectPaths.skills;
  return normalizeSkillDir(raw);
}

export interface SkillHubPlan {
  /** Relative destination directory under the sync root (no trailing slash). */
  destDir: string;
  sourceDir: string;
  skillMdPath: string;
}

/**
 * Plan `.agents/skills/{name}` hub entries plus fan-out into native skill dirs
 * that cannot read the shared hub.
 */
export function planPluginSkillHub(
  skills: readonly ExtractedPluginSkill[],
  portablePlatforms: readonly string[],
  target: SerializerTarget,
): SkillHubPlan[] {
  const hub = agentsSkillHubPrefix();
  const plans: SkillHubPlan[] = [];
  const seen = new Set<string>();

  const push = (destDir: string, sourceDir: string): void => {
    const normalized = destDir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (seen.has(normalized)) return;
    seen.add(normalized);
    plans.push({
      destDir: normalized,
      sourceDir,
      skillMdPath: `${normalized}/SKILL.md`,
    });
  };

  for (const skill of skills) {
    push(`${hub}${skill.name}`, skill.sourceDir);
    for (const platformId of portablePlatforms) {
      const consume = new Set(skillConsumeDirs(platformId, target));
      if (consume.has(hub)) continue;
      const native = nativeSkillDir(platformId, target);
      if (!native || native === hub) continue;
      push(`${native}${skill.name}`, skill.sourceDir);
    }
  }

  return plans;
}

export function materializeSkillHubPlan(
  rootPath: string,
  plans: readonly SkillHubPlan[],
  mode: PluginResourceMode,
): void {
  for (const plan of plans) {
    materializeFromSource(join(rootPath, plan.destDir), plan.sourceDir, mode);
  }
}
