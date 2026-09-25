import { getPlatform } from "../platforms/registry.js";
import type { SerializedFile, SerializerTarget } from "../types.js";
import type { ApplyResult } from "./applier.js";

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

function rewriteSkillTree(
  files: SerializedFile[],
  fromDir: string,
  toDir: string,
  name: string,
): SerializedFile[] {
  const prefix = `${fromDir}${name}/`;
  return files.flatMap((file) => {
    const path = file.path.replace(/\\/g, "/");
    if (path !== `${prefix}SKILL.md` && !path.startsWith(prefix)) {
      return [];
    }
    return [{ ...file, path: `${toDir}${name}/${path.slice(prefix.length)}` }];
  });
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
    platformId: result.platformId,
    files: [...result.files],
  }));
  const host =
    next.find((result) => consume.get(result.platformId)?.has(preferredDir))
    ?? next[0];
  if (!host) {
    return results;
  }

  for (const name of skillNames) {
    const rewritten: SerializedFile[] = [];
    const seenRel = new Set<string>();
    for (const result of next) {
      const parsed = result.files
        .map((file) => parseSkillEmitPath(file.path))
        .find((entry) => entry?.name === name);
      if (!parsed) continue;
      for (const file of rewriteSkillTree(
        result.files,
        parsed.skillsDir,
        preferredDir,
        name,
      )) {
        const rel = file.path.slice(`${preferredDir}${name}/`.length);
        if (seenRel.has(rel)) continue;
        seenRel.add(rel);
        rewritten.push(file);
      }
    }
    if (rewritten.length === 0) continue;

    for (const result of next) {
      if (consume.get(result.platformId)?.has(preferredDir)) {
        result.files = dropSkillTree(result.files, name);
      }
    }
    const seen = new Set(host.files.map((file) => file.path.replace(/\\/g, "/")));
    for (const file of rewritten) {
      const path = file.path.replace(/\\/g, "/");
      if (seen.has(path)) continue;
      seen.add(path);
      host.files.push({ ...file, path });
    }
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
