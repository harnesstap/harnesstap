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
 * Plan removals for profile switch/re-apply.
 * Only previously profile-managed paths that are not in the incoming desired set
 * are removed — on-disk skills that were never applied by a profile (not staged)
 * are left alone.
 */
export function planStaleGlobalProfileFiles(
  _homeRoot: string,
  desiredFiles: readonly string[],
  previousTrackedFiles: readonly string[],
  _harnesses: string[],
): string[] {
  const desired = new Set(desiredFiles);
  return [
    ...new Set(
      previousTrackedFiles.filter((filePath) => !desired.has(filePath)),
    ),
  ];
}
