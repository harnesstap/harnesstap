import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  listGlobalApplySnapshotHeads,
  listGlobalApplySnapshotInstalls,
} from "../models/global-apply-snapshot.js";
import { getPlatform } from "../platforms/registry.js";
import { isCursorHostManagedSkillsPath } from "./cursor-host-managed-skills.js";
import { isMergeableHostConfigPath } from "./merged-host-config.js";
import { isHarnessTapOwnedPath, type SafeRemovalSkip } from "./safe-file-removal.js";

export function collectOtherProfilesSnapshotTrackedFiles(
  incomingProfileName: string,
): string[] {
  const tracked = new Set<string>();
  const seenProfiles = new Set<string>();

  for (const snapshot of listGlobalApplySnapshotHeads()) {
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

    if (isCursorHostManagedSkillsPath(configuredSkills)) {
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
 * tools that still read it (Cursor, Codex, ...). Map removed managed skill files
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
function isOwnedOrUnknown(homeRoot: string, relativePath: string): boolean {
  try {
    return isHarnessTapOwnedPath(homeRoot, relativePath);
  } catch {
    return false;
  }
}

export function expandStaleMcpConfigMirrors(
  staleFiles: readonly string[],
  desiredFiles: ReadonlySet<string>,
  harnesses: readonly string[],
  homeRoot = "",
): string[] {
  const expanded = new Set(staleFiles);
  const staleHasMcp = staleFiles.some((filePath) =>
    isDedicatedMcpConfigPath(filePath),
  );
  if (!staleHasMcp) {
    return [...expanded];
  }

  for (const mcpPath of collectGlobalDedicatedMcpConfigPaths(harnesses)) {
    if (desiredFiles.has(mcpPath) || expanded.has(mcpPath)) {
      continue;
    }
    if (homeRoot && !isOwnedOrUnknown(homeRoot, mcpPath)) {
      continue;
    }
    if (!homeRoot) {
      continue;
    }
    expanded.add(mcpPath);
  }
  return [...expanded];
}

export function planStaleMergeableHostConfigFiles(
  homeRoot: string,
  desiredFiles: readonly string[],
  previousTrackedFiles: readonly string[],
  harnesses: readonly string[] = [],
): string[] {
  const desired = new Set(desiredFiles);
  const mergeFiles = new Set(
    previousTrackedFiles.filter(
      (filePath) =>
        !desired.has(filePath)
        && isMergeableHostConfigPath(filePath)
        && !isCursorHostManagedSkillsPath(filePath),
    ),
  );
  const leavingMcp = [...mergeFiles].some((filePath) =>
    isDedicatedMcpConfigPath(filePath),
  );
  if (leavingMcp && homeRoot) {
    for (const mcpPath of collectGlobalDedicatedMcpConfigPaths(harnesses)) {
      if (desired.has(mcpPath) || mergeFiles.has(mcpPath)) {
        continue;
      }
      if (!isOwnedOrUnknown(homeRoot, mcpPath)) {
        continue;
      }
      if (isMergeableHostConfigPath(mcpPath)) {
        mergeFiles.add(mcpPath);
      }
    }
  }
  return [...mergeFiles];
}

/**
 * Plan whole-file removals for profile switch/re-apply.
 * Shared configs and instruction files are excluded (key/block rewrite
 * happens separately). Skill removals also drop the shared hub mirror.
 * Dedicated MCP configs on other harnesses are added only when HarnessTap
 * has an ownership record for that path.
 */
export function planStaleGlobalProfileFiles(
  homeRoot: string,
  desiredFiles: readonly string[],
  previousTrackedFiles: readonly string[],
  harnesses: string[],
): string[] {
  const desired = new Set(desiredFiles);
  const stale = previousTrackedFiles.filter(
    (filePath) =>
      !desired.has(filePath)
      && !isMergeableHostConfigPath(filePath)
      && !isCursorHostManagedSkillsPath(filePath),
  );
  return expandStaleMcpConfigMirrors(
    expandStaleSkillHubMirrors(stale, desired),
    desired,
    harnesses,
    homeRoot,
  );
}

const HOST_PLUGIN_FOLDER_RE = /^(.*?(?:^|\/)plugins\/cache\/[^/]+\/[^/]+\/[^/]+)\//;

function hostPluginFolderOf(path: string): string | undefined {
  return HOST_PLUGIN_FOLDER_RE.exec(path.replace(/\\/g, "/"))?.[1];
}

function listFolderEntries(rootPath: string, folder: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let names: string[];
    try {
      names = readdirSync(join(rootPath, rel));
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const child = `${rel}/${name}`;
      let isDir = false;
      try {
        // lstat: a link is an entry of its own, never followed.
        isDir = lstatSync(join(rootPath, child)).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(child);
      else out.push(child);
    }
  };
  walk(folder);
  return out;
}

/**
 * Files that stay in a host plugin folder the apply leaves behind (a profile
 * switch or a version bump) and that the removal did not already report:
 * the user's own files, which HarnessTap never wrote. Reported as kept so
 * nothing is left there silently.
 */
export function keptFilesInLeftHostPluginFolders(
  rootPath: string,
  desiredFiles: readonly string[],
  staleFiles: readonly string[],
  removed: readonly string[],
  skipped: readonly SafeRemovalSkip[],
): SafeRemovalSkip[] {
  const inUse = new Set(
    desiredFiles.map(hostPluginFolderOf).filter((folder): folder is string => Boolean(folder)),
  );
  const left = new Set(
    staleFiles
      .map(hostPluginFolderOf)
      .filter((folder): folder is string => Boolean(folder) && !inUse.has(folder as string)),
  );
  const reported = new Set([
    ...removed,
    ...skipped.filter((skip) => skip.reason !== "missing").map((skip) => skip.path),
  ]);
  const kept: SafeRemovalSkip[] = [];
  for (const folder of [...left].sort()) {
    if (!existsSync(join(rootPath, folder))) continue;
    for (const path of listFolderEntries(rootPath, folder)) {
      if (reported.has(path)) continue;
      kept.push({
        path,
        reason: "unmanaged",
        message: `Skipped removing ${path} (not managed by HarnessTap).`,
      });
    }
  }
  return kept;
}
