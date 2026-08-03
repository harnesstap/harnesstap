import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  listGlobalApplySnapshotInstalls,
  listGlobalApplySnapshots,
} from "../models/global-apply-snapshot.js";
import { getPlatform } from "../platforms/registry.js";

export function collectOtherProfilesSnapshotTrackedFiles(
  incomingProfileName: string,
): string[] {
  const tracked = new Set<string>();
  const seenProfiles = new Set<string>();

  for (const snapshot of listGlobalApplySnapshots()) {
    if (snapshot.profile_name === incomingProfileName) {
      continue;
    }
    if (seenProfiles.has(snapshot.profile_name)) {
      continue;
    }
    seenProfiles.add(snapshot.profile_name);
    for (const install of listGlobalApplySnapshotInstalls(snapshot.id)) {
      for (const filePath of install.files) {
        tracked.add(filePath);
      }
    }
  }

  return [...tracked];
}

const SHARED_GLOBAL_SKILL_HUB = ".agents/skills";
const SKILL_FILE_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i;

export function collectOrphanSkillFilesOnDisk(
  homeRoot: string,
  platformIds: string[],
  desiredFiles: ReadonlySet<string>,
): string[] {
  const orphans = new Set<string>();

  for (const platformId of platformIds) {
    const platform = getPlatform(platformId);
    const configuredSkills = platform?.globalPaths.skills;
    if (!configuredSkills?.startsWith("~/")) {
      continue;
    }

    const relativeSkillsRoot = configuredSkills.slice(2).replace(/\/$/, "");
    const skillsDir = join(homeRoot, relativeSkillsRoot);
    let entries: string[];
    try {
      entries = readdirSync(skillsDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) {
        continue;
      }
      const entryPath = join(skillsDir, entry);
      try {
        if (!statSync(entryPath).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      const skillRelative = `${relativeSkillsRoot}/${entry}/SKILL.md`;
      if (desiredFiles.has(skillRelative)) {
        continue;
      }
      if (existsSync(join(homeRoot, skillRelative))) {
        orphans.add(skillRelative);
      }
    }
  }

  return [...orphans];
}

/**
 * Skill-package installs keep a canonical copy under `~/.agents/skills/{name}/`
 * and fan out to harness-specific skill dirs. Profile apply historically tracked
 * only the harness paths, so switching away left the shared hub active for
 * tools that still read it (Cursor, Codex, …). Map removed managed skill files
 * onto the hub path when the incoming profile does not keep that skill.
 */
export function expandStaleSkillHubMirrors(
  staleFiles: readonly string[],
  desiredFiles: ReadonlySet<string>,
): string[] {
  const expanded = new Set(staleFiles);
  const desiredSkillNames = new Set<string>();
  for (const desiredPath of desiredFiles) {
    const desiredMatch = desiredPath.match(SKILL_FILE_RE);
    const skillName = desiredMatch?.[1];
    if (skillName) {
      desiredSkillNames.add(skillName);
    }
  }

  for (const filePath of staleFiles) {
    const match = filePath.match(SKILL_FILE_RE);
    const skillName = match?.[1];
    if (!skillName || desiredSkillNames.has(skillName)) {
      continue;
    }
    expanded.add(`${SHARED_GLOBAL_SKILL_HUB}/${skillName}/SKILL.md`);
  }

  return [...expanded];
}

const DEDICATED_MCP_CONFIG_RE =
  /(^|\/)(\.?mcp\.json|mcp[-_]config\.json)$/i;

function isDedicatedMcpConfigPath(path: string): boolean {
  return DEDICATED_MCP_CONFIG_RE.test(path.replace(/^~\//, ""));
}

/**
 * Global dedicated MCP config paths for the harnesses in this apply
 * (e.g. `.cursor/mcp.json`, `.copilot/mcp-config.json`). Excludes aggregate
 * settings files that embed MCP among other keys (config.toml, settings.json).
 */
export function collectGlobalDedicatedMcpConfigPaths(
  platformIds: readonly string[],
): string[] {
  const paths = new Set<string>();
  for (const platformId of platformIds) {
    const platform = getPlatform(platformId);
    if (!platform) {
      continue;
    }
    for (const candidate of [
      platform.globalPaths.mcp,
      platform.globalPaths.settings,
    ]) {
      if (!candidate?.startsWith("~/")) {
        continue;
      }
      const relative = candidate.slice(2).replace(/\/$/, "");
      if (!isDedicatedMcpConfigPath(relative)) {
        continue;
      }
      paths.add(relative);
    }
  }
  return [...paths];
}

/**
 * MCP resources are often path-bound to one harness file (e.g. `~/.cursor/mcp.json`)
 * and intentionally not cross-written. Switching away still needs to clear other
 * harness MCP configs that may hold the same servers from earlier installs.
 */
export function expandStaleMcpConfigMirrors(
  staleFiles: readonly string[],
  desiredFiles: ReadonlySet<string>,
  harnesses: readonly string[],
): string[] {
  const expanded = new Set(staleFiles);
  const staleHasMcp = staleFiles.some((filePath) =>
    isDedicatedMcpConfigPath(filePath),
  );
  if (!staleHasMcp) {
    return [...expanded];
  }

  for (const mcpPath of collectGlobalDedicatedMcpConfigPaths(harnesses)) {
    if (!desiredFiles.has(mcpPath)) {
      expanded.add(mcpPath);
    }
  }
  return [...expanded];
}

/**
 * Plan removals for profile switch/re-apply.
 * Only previously profile-managed paths that are not in the incoming desired set
 * are removed — on-disk skills that were never applied by a profile (not staged)
 * are left alone. Managed skill removals also drop the shared `~/.agents/skills`
 * hub mirror for the same skill name. Managed MCP config removals also drop
 * dedicated MCP configs on other apply harnesses that are not desired.
 */
export function planStaleGlobalProfileFiles(
  _homeRoot: string,
  desiredFiles: readonly string[],
  previousTrackedFiles: readonly string[],
  harnesses: string[],
): string[] {
  const desired = new Set(desiredFiles);
  const stale = previousTrackedFiles.filter((filePath) => !desired.has(filePath));
  return expandStaleMcpConfigMirrors(
    expandStaleSkillHubMirrors(stale, desired),
    desired,
    harnesses,
  );
}
