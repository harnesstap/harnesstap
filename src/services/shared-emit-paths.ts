import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPlatform } from "../platforms/registry.js";
import type { SerializedFile, SerializerTarget } from "../types.js";
import type { ApplyResult } from "./applier.js";
import { isPreexistingPath } from "../models/preexisting-path.js";
import {
  listMaterializationsForRoot,
  listMaterializationsForRootPath,
} from "../models/resource-materialization.js";

const SKILL_FILE_RE = /^(.*)\/skills\/([^/]+)\/(.*)$/;

export interface SkillFileRef {
  skillsDir: string;
  name: string;
  rest: string;
}

export function normalizeSkillDir(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.startsWith("~/")) {
    normalized = normalized.slice(2);
  }
  if (!normalized) return undefined;
  return `${normalized}/`;
}

export function parseSkillEmitPath(path: string): SkillFileRef | undefined {
  const normalized = path.replace(/\\/g, "/");
  // Host plugin install trees often contain skills/; those are not harness skill emits.
  if (/(^|\/)plugins\//.test(normalized)) return undefined;
  const match = SKILL_FILE_RE.exec(normalized);
  if (!match) return undefined;
  const prefix = match[1];
  const name = match[2];
  const rest = match[3];
  if (prefix === undefined || !name || rest === undefined) return undefined;
  return {
    skillsDir: `${prefix}/skills/`,
    name,
    rest,
  };
}

function projectCompatFromRelated(path: string): string | undefined {
  const normalized = normalizeSkillDir(path);
  if (normalized === ".claude/skills/" || normalized === ".agents/skills/") {
    return normalized;
  }
  return undefined;
}

/** Directories this harness can read for skills (native, alternates, documented compat). */
export function skillConsumeDirs(
  platformId: string,
  target: SerializerTarget,
): string[] {
  const platform = getPlatform(platformId);
  if (!platform) return [];
  const paths = target === "global" ? platform.globalPaths : platform.projectPaths;
  const dirs: string[] = [];
  const add = (raw?: string): void => {
    const normalized = normalizeSkillDir(raw);
    if (normalized && !dirs.includes(normalized)) {
      dirs.push(normalized);
    }
  };

  add(paths.skills);
  for (const alternate of paths.pathAlternates?.skills ?? []) {
    add(alternate);
  }
  for (const related of platform.relatedLocations ?? []) {
    if (!related.surfaces.includes("skills")) continue;
    add(related.path);
    if (target === "project") {
      add(projectCompatFromRelated(related.path));
    }
  }
  if (target === "global") {
    const projectSkills = platform.projectPaths.skills;
    if (projectSkills?.startsWith(".agents/")) {
      add(projectSkills);
    }
  }
  return dirs;
}

export function sharedSkillDirRank(dir: string): number {
  const normalized = normalizeSkillDir(dir) ?? dir;
  if (normalized === ".agents/skills/") return 2;
  if (normalized === ".claude/skills/") return 1;
  return 0;
}

function preferredSharedDir(
  platformIds: readonly string[],
  target: SerializerTarget,
): string | undefined {
  const consumerCounts = new Map<string, number>();
  for (const platformId of platformIds) {
    const seen = new Set<string>();
    for (const dir of skillConsumeDirs(platformId, target)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      consumerCounts.set(dir, (consumerCounts.get(dir) ?? 0) + 1);
    }
  }
  let best: string | undefined;
  let bestRank = 0;
  for (const [dir, count] of consumerCounts) {
    if (count < 2) continue;
    const rank = sharedSkillDirRank(dir);
    if (rank > bestRank) {
      best = dir;
      bestRank = rank;
    }
  }
  return bestRank > 0 ? best : undefined;
}

function dropSkillTree(
  files: SerializedFile[],
  name: string,
): SerializedFile[] {
  return files.filter((file) => {
    const parsed = parseSkillEmitPath(file.path);
    return parsed?.name !== name;
  });
}

/**
 * When two or more configured harnesses can read a shared skill tree
 * (`.agents/skills` first, then Claude-compat), emit once there and drop
 * native copies for those consumers. Harnesses that cannot read the shared
 * tree keep their native emit.
 */
export function preferSharedSkillEmits(
  results: ApplyResult[],
  platformIds: readonly string[],
  target: SerializerTarget,
  options?: { skipSkillNames?: ReadonlySet<string> },
): ApplyResult[] {
  const preferredDir = preferredSharedDir(platformIds, target);
  if (!preferredDir) {
    return results;
  }

  const consume = new Map(
    platformIds.map((id) => [id, new Set(skillConsumeDirs(id, target))]),
  );
  const skillNames = new Set<string>();
  for (const result of results) {
    for (const file of result.files) {
      const parsed = parseSkillEmitPath(file.path);
      if (parsed) skillNames.add(parsed.name);
    }
  }

  const next = results.map((result) => ({
    ...result,
    files: [...result.files],
  }));
  const host =
    next.find((result) => consume.get(result.platformId)?.has(preferredDir))
    ?? next[0];
  if (!host) {
    return results;
  }

  for (const name of skillNames) {
    if (options?.skipSkillNames?.has(name)) {
      continue;
    }
    placeSkillOnHost(next, host, name, preferredDir, consume);
  }

  return next;
}

function skillRelativePath(dir: string, name: string): string {
  return `${dir}${name}/SKILL.md`.replace(/^\.\//, "");
}

function isUnmanagedLiveSkill(
  rootPath: string,
  relativePath: string,
): boolean {
  if (isPreexistingPath(rootPath, relativePath)) {
    return true;
  }
  return listMaterializationsForRootPath(rootPath, relativePath).length === 0;
}

function existingUnmanagedSkillConsumeDir(
  rootPath: string,
  name: string,
  consumeDirs: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestRank = -1;
  for (const dir of consumeDirs) {
    const relative = skillRelativePath(dir, name);
    if (!existsSync(join(rootPath, relative))) {
      continue;
    }
    if (!isUnmanagedLiveSkill(rootPath, relative)) {
      continue;
    }
    const rank = sharedSkillDirRank(dir);
    if (rank > bestRank) {
      best = dir;
      bestRank = rank;
    }
  }
  return best;
}

function addSkillPlacement(
  placements: Map<string, string[]>,
  name: string,
  skillsDir: string,
): void {
  const dirs = placements.get(name) ?? [];
  if (!dirs.includes(skillsDir)) {
    dirs.push(skillsDir);
  }
  placements.set(name, dirs);
}

export function collectManagedSkillPlacements(rootPath: string): Map<string, string[]> {
  const placements = new Map<string, string[]>();
  for (const row of listMaterializationsForRoot(rootPath)) {
    const parsed = parseSkillEmitPath(row.path);
    if (!parsed || parsed.rest !== "SKILL.md") {
      continue;
    }
    addSkillPlacement(placements, parsed.name, parsed.skillsDir);
  }
  return placements;
}

/** Build skill-name -> emit dirs from a previous apply lock or materialization path set. */
export function skillPlacementsFromPaths(
  paths: Iterable<string>,
): Map<string, string[]> {
  const placements = new Map<string, string[]>();
  for (const path of paths) {
    const parsed = parseSkillEmitPath(path);
    if (!parsed || parsed.rest !== "SKILL.md") {
      continue;
    }
    addSkillPlacement(placements, parsed.name, parsed.skillsDir);
  }
  return placements;
}

function collectSkillTreeByRest(
  results: ApplyResult[],
  name: string,
): Map<string, SerializedFile> {
  const byRest = new Map<string, SerializedFile>();
  for (const result of results) {
    for (const file of result.files) {
      const parsed = parseSkillEmitPath(file.path);
      if (parsed?.name !== name) continue;
      if (!byRest.has(parsed.rest)) {
        byRest.set(parsed.rest, file);
      }
    }
  }
  return byRest;
}

function placeSkillOnHost(
  results: ApplyResult[],
  host: ApplyResult,
  name: string,
  destDir: string,
  consume: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const byRest = collectSkillTreeByRest(results, name);
  if (byRest.size === 0) {
    return;
  }
  for (const result of results) {
    if (consume.get(result.platformId)?.has(destDir)) {
      result.files = dropSkillTree(result.files, name);
    }
  }
  const seen = new Set(host.files.map((file) => file.path.replace(/\\/g, "/")));
  for (const [rest, file] of byRest) {
    const path = `${destDir}${name}/${rest}`;
    if (seen.has(path)) continue;
    seen.add(path);
    host.files.push({ ...file, path });
  }
}

function placeSkillOnDirs(
  results: ApplyResult[],
  name: string,
  destDirs: readonly string[],
  consume: ReadonlyMap<string, ReadonlySet<string>>,
  fallbackHost?: ApplyResult,
): void {
  const uniqueDirs = [...new Set(destDirs.filter(Boolean))];
  if (uniqueDirs.length === 0) {
    return;
  }
  const byRest = collectSkillTreeByRest(results, name);
  if (byRest.size === 0) {
    return;
  }

  for (const result of results) {
    result.files = dropSkillTree(result.files, name);
  }

  for (const destDir of uniqueDirs) {
    const host =
      results.find((result) => consume.get(result.platformId)?.has(destDir))
      ?? fallbackHost
      ?? results[0];
    if (!host) {
      continue;
    }
    const seen = new Set(host.files.map((file) => file.path.replace(/\\/g, "/")));
    for (const [rest, file] of byRest) {
      const path = `${destDir}${name}/${rest}`;
      if (seen.has(path)) continue;
      seen.add(path);
      host.files.push({ ...file, path });
    }
  }
}

/**
 * Pin skill emits to previous apply placements (all of them) or, on first
 * apply, to a genuinely unmanaged live skill path. Disk existence of a
 * shared dir such as `.agents/skills` must not relocate a later apply.
 */
export function pinSkillEmitsToExistingLivePaths(
  rootPath: string,
  results: ApplyResult[],
  platformIds: readonly string[],
  target: SerializerTarget,
  options?: { previousManagedPlacements?: ReadonlyMap<string, readonly string[]> },
): ApplyResult[] {
  const consumeDirs = [
    ...new Set(platformIds.flatMap((id) => skillConsumeDirs(id, target))),
  ];
  if (consumeDirs.length === 0) {
    return results;
  }

  const consume = new Map(
    platformIds.map((id) => [id, new Set(skillConsumeDirs(id, target))]),
  );
  const skillNames = new Set<string>();
  for (const result of results) {
    for (const file of result.files) {
      const parsed = parseSkillEmitPath(file.path);
      if (parsed) skillNames.add(parsed.name);
    }
  }

  const next = results.map((result) => ({
    ...result,
    files: [...result.files],
  }));
  const previousManaged =
    options?.previousManagedPlacements ?? collectManagedSkillPlacements(rootPath);

  const consumeDirSet = new Set(consumeDirs);
  for (const name of skillNames) {
    const previousDirs = [...(previousManaged.get(name) ?? [])].filter((dir) =>
      consumeDirSet.has(dir),
    );
    if (previousDirs.length > 0) {
      placeSkillOnDirs(next, name, previousDirs, consume, next[0]);
      continue;
    }
    const unmanagedDir = existingUnmanagedSkillConsumeDir(
      rootPath,
      name,
      consumeDirs,
    );
    if (!unmanagedDir) {
      continue;
    }
    const host =
      next.find((result) => consume.get(result.platformId)?.has(unmanagedDir))
      ?? next[0];
    if (!host) {
      continue;
    }
    placeSkillOnHost(next, host, name, unmanagedDir, consume);
  }

  return next;
}

export function flattenUniqueFiles(results: ApplyResult[]): SerializedFile[] {
  const byPath = new Map<string, SerializedFile>();
  for (const result of results) {
    for (const file of result.files) {
      byPath.set(file.path.replace(/\\/g, "/"), {
        ...file,
        path: file.path.replace(/\\/g, "/"),
      });
    }
  }
  return [...byPath.values()];
}
