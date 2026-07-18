import { refreshGitSource } from "../plugins/refresh.js";
import { classifyRepo } from "./repo-profile.js";
import {
  discoverSkillPackage,
  type DiscoveredSkill,
} from "./skill-discovery.js";
import {
  resolveRemoteSource,
  sourceCacheDir,
} from "./source-resolver.js";

export const DEFAULT_EXCLUDED_SKILL_CATEGORIES = ["dbt-migration"] as const;

export type LayerSourceConflictPolicy = "cancel" | "merge" | "overwrite";

export interface ResolvedSkillPackage {
  checkoutRoot: string;
  namespace: string;
  gitUrl?: string;
  gitSha?: string;
  discovered: DiscoveredSkill[];
}

export function skillPackageHint(primary: string): string {
  return `Source is not a skill package (detected: ${primary}). Use a repo with skills/ or .agents/skills/ containing SKILL.md files.`;
}

export function defaultInteractiveSkillNames(
  discovered: DiscoveredSkill[],
  excludeCategories: readonly string[] = DEFAULT_EXCLUDED_SKILL_CATEGORIES,
): string[] {
  const excluded = new Set(excludeCategories);
  return discovered
    .filter((skill) => !excluded.has(skill.category))
    .map((skill) => skill.name);
}

export function resolveSkillPackageCheckout(
  source: string,
  harnesstapDir: string,
): ResolvedSkillPackage {
  const resolved = resolveRemoteSource(source);
  let checkoutRoot: string;
  let gitUrl: string | undefined;
  let gitSha: string | undefined;

  if (resolved.kind === "git") {
    const cacheDir = sourceCacheDir(
      harnesstapDir,
      resolved.owner,
      resolved.repo,
    );
    const refresh = refreshGitSource({
      url: resolved.url,
      targetDir: cacheDir,
    });
    if (!refresh.ok) {
      throw new Error(refresh.message);
    }
    checkoutRoot = cacheDir;
    gitUrl = resolved.url;
    gitSha = refresh.sha;
  } else {
    checkoutRoot = resolved.path;
  }

  const classification = classifyRepo(checkoutRoot);
  if (classification.primary !== "skill-package") {
    throw new Error(skillPackageHint(classification.primary));
  }

  const discovered = discoverSkillPackage(checkoutRoot);
  if (discovered.length === 0) {
    throw new Error(`No skills found in skill package: ${checkoutRoot}`);
  }

  return {
    checkoutRoot,
    namespace: resolved.label,
    gitUrl,
    gitSha,
    discovered,
  };
}

export function resolveSelectedSkills(
  discovered: DiscoveredSkill[],
  options: {
    skillNames?: string[];
    all?: boolean;
    excludeCategories?: string[];
  },
): DiscoveredSkill[] {
  const discoveredNames = new Set(discovered.map((skill) => skill.name));
  const excludeCategories = new Set(options.excludeCategories ?? []);

  const applyCategoryExclusions = (skills: DiscoveredSkill[]): DiscoveredSkill[] => {
    if (excludeCategories.size === 0) {
      return skills;
    }
    return skills.filter((skill) => !excludeCategories.has(skill.category));
  };

  if (options.all) {
    const selected = applyCategoryExclusions(discovered);
    if (selected.length === 0) {
      throw new Error("No skills selected after applying category exclusions.");
    }
    return selected;
  }

  if (options.skillNames && options.skillNames.length > 0) {
    const missing = options.skillNames.filter((name) => !discoveredNames.has(name));
    if (missing.length > 0) {
      throw new Error(`Skill(s) not found: ${missing.join(", ")}`);
    }
    const selected = new Set(options.skillNames);
    const skills = discovered.filter((skill) => selected.has(skill.name));
    const filtered = applyCategoryExclusions(skills);
    if (filtered.length === 0) {
      throw new Error("No skills selected after applying category exclusions.");
    }
    return filtered;
  }

  throw new Error(
    "No skills selected. Pass --skill <names>, --all, or use the wizard.",
  );
}
