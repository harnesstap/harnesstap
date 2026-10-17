import { getAllPlatforms } from "../platforms/registry.js";
import {
  resourceHarnessScope,
  type HarnessScope,
} from "./harness-scope.js";
import { mergePluginsForApply } from "./plugin-apply-merge.js";
import { parseSkillEmitPath, skillConsumeDirs } from "./shared-emit-paths.js";

const consumeDirsByPlatform = new Map<string, ReadonlySet<string>>();

function consumeDirsForPlatform(platformId: string): ReadonlySet<string> {
  const cached = consumeDirsByPlatform.get(platformId);
  if (cached) {
    return cached;
  }
  const dirs = new Set<string>([
    ...skillConsumeDirs(platformId, "global"),
    ...skillConsumeDirs(platformId, "project"),
  ]);
  consumeDirsByPlatform.set(platformId, dirs);
  return dirs;
}

function platformsConsumingSkillDir(skillsDir: string): string[] {
  const ids: string[] = [];
  for (const platform of getAllPlatforms()) {
    if (consumeDirsForPlatform(platform.id).has(skillsDir)) {
      ids.push(platform.id);
    }
  }
  return ids;
}

export function resourceScopesForPlugins(
  pluginIds: readonly string[] | undefined,
): Map<string, HarnessScope> {
  const map = new Map<string, HarnessScope>();
  if (!pluginIds || pluginIds.length === 0) {
    return map;
  }
  for (const resource of mergePluginsForApply([...pluginIds]).resources) {
    map.set(`${resource.type}:${resource.name}`, resourceHarnessScope(resource));
  }
  return map;
}

/**
 * A missing harness copy is transparent when another on-disk copy already
 * covers it. A subset scope is not covered by a sibling the new harness
 * cannot read (Codex does not read ~/.claude/skills).
 */
export function isTransparentCrossHarnessGap(input: {
  path: string;
  onDiskSiblingPaths: readonly string[];
  scope?: HarnessScope;
}): boolean {
  if (input.onDiskSiblingPaths.length === 0) {
    return false;
  }
  if (!input.scope || input.scope.kind === "all") {
    return true;
  }
  const missingDir = parseSkillEmitPath(input.path)?.skillsDir;
  if (!missingDir) {
    return true;
  }
  const scoped = new Set(input.scope.harnesses);
  const consumers = platformsConsumingSkillDir(missingDir).filter((id) => scoped.has(id));
  if (consumers.length === 0) {
    return true;
  }
  return consumers.every((id) => {
    const dirs = consumeDirsForPlatform(id);
    return input.onDiskSiblingPaths.some((path) => {
      const dir = parseSkillEmitPath(path)?.skillsDir;
      return dir !== undefined && dirs.has(dir);
    });
  });
}

/**
 * On-disk copies of a missing skill file in another folder that a harness
 * reading the missing folder also reads. Apply places the skill on such a
 * live copy (for example ~/.agents/skills, which Cursor reads) instead of
 * writing the harness default, so status must not call the default missing.
 */
export function liveSkillCopiesForMissingPath(
  path: string,
  harnesses: readonly string[],
  exists: (relativePath: string) => boolean,
): string[] {
  const parsed = parseSkillEmitPath(path);
  if (!parsed) {
    return [];
  }
  const active = new Set(harnesses);
  const dirs = new Set<string>();
  for (const id of platformsConsumingSkillDir(parsed.skillsDir)) {
    if (!active.has(id)) continue;
    for (const dir of consumeDirsForPlatform(id)) {
      if (dir !== parsed.skillsDir) dirs.add(dir);
    }
  }
  return [...dirs]
    .map((dir) => `${dir}${parsed.name}/${parsed.rest}`)
    .filter((candidate) => exists(candidate));
}
