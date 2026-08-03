import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { getPlatform } from "../platforms/registry.js";

export const CURSOR_HOST_MANAGED_SKILLS_DISPLAY_ROOT =
  "~/.cursor/skills-cursor";
export const CURSOR_USER_SKILLS_DISPLAY_ROOT = "~/.cursor/skills";

export type CursorHostSkillOverlap = "user_skill" | "profile_skill";

export interface CursorHostManagedSkill {
  name: string;
  source: string;
  description: string;
}

export interface CursorHostManagedSkillCollision {
  name: string;
  host_source: string;
  user_source: string;
  overlap: CursorHostSkillOverlap;
}

export interface CursorHostManagedSkillsStatus {
  skills: CursorHostManagedSkill[];
  collisions: CursorHostManagedSkillCollision[];
}

export interface HostManagedStatus {
  cursor?: CursorHostManagedSkillsStatus;
}

function resolveConfiguredHomePath(
  homeRoot: string,
  configuredPath: string,
): string {
  return configuredPath.startsWith("~/")
    ? join(homeRoot, configuredPath.slice(2))
    : join(homeRoot, configuredPath);
}

function hostManagedSkillsConfiguredPath(): string {
  const platform = getPlatform("cursor");
  return (
    platform?.hostManagedPaths?.skills ?? `${CURSOR_HOST_MANAGED_SKILLS_DISPLAY_ROOT}/`
  );
}

function userSkillsConfiguredPath(): string {
  const platform = getPlatform("cursor");
  return platform?.globalPaths.skills ?? `${CURSOR_USER_SKILLS_DISPLAY_ROOT}/`;
}

function tryParseSkillFrontmatter(content: string):
  | { data: Record<string, unknown>; content: string }
  | undefined {
  try {
    const parsed = matter(content);
    if (content.startsWith("---") && parsed.content === content) {
      return undefined;
    }
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content,
    };
  } catch {
    return undefined;
  }
}

/** Read-only inventory of Cursor app-managed skills under skills-cursor. */
export function scanCursorHostManagedSkills(
  homeRoot: string,
): CursorHostManagedSkill[] {
  const configured = hostManagedSkillsConfiguredPath();
  const fullPath = resolveConfiguredHomePath(homeRoot, configured);
  if (!existsSync(fullPath)) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(fullPath);
  } catch {
    return [];
  }

  const displayRoot = configured.replace(/\/$/, "");
  const skills: CursorHostManagedSkill[] = [];

  for (const entry of entries) {
    const entryPath = join(fullPath, entry);
    const skillMd = join(entryPath, "SKILL.md");
    try {
      if (!statSync(entryPath).isDirectory() || !existsSync(skillMd)) {
        continue;
      }
    } catch {
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(skillMd, "utf-8");
    } catch {
      continue;
    }

    const parsed = tryParseSkillFrontmatter(raw);
    if (!parsed) {
      continue;
    }

    const name =
      typeof parsed.data["name"] === "string" && parsed.data["name"].trim()
        ? parsed.data["name"].trim()
        : entry;
    const description =
      typeof parsed.data["description"] === "string"
        ? parsed.data["description"]
        : "";

    skills.push({
      name,
      source: `${displayRoot}/${entry}/SKILL.md`,
      description,
    });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function userSkillSourceForName(name: string): string {
  const configured = userSkillsConfiguredPath().replace(/\/$/, "");
  return `${configured}/${name}/SKILL.md`;
}

function profileSkillSource(
  profileSkills: ReadonlyMap<string, string>,
  name: string,
): string {
  return profileSkills.get(name) ?? `profile skill:${name}`;
}

export function detectCursorHostManagedSkillCollisions(input: {
  hostSkills: readonly CursorHostManagedSkill[];
  homeRoot: string;
  /** Map of profile skill name → source path/label. */
  profileSkills?: ReadonlyMap<string, string>;
}): CursorHostManagedSkillCollision[] {
  const userSkillsRoot = resolveConfiguredHomePath(
    input.homeRoot,
    userSkillsConfiguredPath(),
  );
  const profileSkills = input.profileSkills ?? new Map<string, string>();
  const collisions: CursorHostManagedSkillCollision[] = [];

  for (const host of input.hostSkills) {
    const userSkillMd = join(userSkillsRoot, host.name, "SKILL.md");
    if (existsSync(userSkillMd)) {
      collisions.push({
        name: host.name,
        host_source: host.source,
        user_source: userSkillSourceForName(host.name),
        overlap: "user_skill",
      });
    }

    if (profileSkills.has(host.name)) {
      collisions.push({
        name: host.name,
        host_source: host.source,
        user_source: profileSkillSource(profileSkills, host.name),
        overlap: "profile_skill",
      });
    }
  }

  return collisions.sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.overlap.localeCompare(right.overlap);
  });
}

export function buildCursorHostManagedStatus(input: {
  homeRoot: string;
  profileSkills?: ReadonlyMap<string, string>;
}): CursorHostManagedSkillsStatus {
  const skills = scanCursorHostManagedSkills(input.homeRoot);
  const collisions = detectCursorHostManagedSkillCollisions({
    hostSkills: skills,
    homeRoot: input.homeRoot,
    profileSkills: input.profileSkills,
  });
  return { skills, collisions };
}

export function buildHostManagedStatus(input: {
  homeRoot: string;
  profileSkills?: ReadonlyMap<string, string>;
}): HostManagedStatus {
  return {
    cursor: buildCursorHostManagedStatus(input),
  };
}

export function profileSkillNameMap(
  resources: ReadonlyArray<{ type: string; name: string; source: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const resource of resources) {
    if (resource.type !== "skill") continue;
    if (!map.has(resource.name)) {
      map.set(resource.name, resource.source);
    }
  }
  return map;
}
