import { resolve } from "node:path";
import { refreshGitSource } from "../plugins/refresh.js";
import {
  getImportedSnapshot,
  recordImportedSnapshotInstall,
} from "../models/imported-snapshot.js";
import { getDb } from "../db/connection.js";
import { classifyRepo } from "./repo-profile.js";
import { resolveScanGlobalHarnessTargets } from "./harness-targets.js";
import { importSkillPackage } from "./skill-package-import.js";
import {
  discoverSkillPackage,
  type DiscoveredSkill,
} from "./skill-discovery.js";
import {
  installSkillsToGlobal,
  installSkillsToProject,
} from "./skill-install.js";
import {
  resolveRemoteSource,
  sourceCacheDir,
} from "./source-resolver.js";

export interface AddSkillPackageOptions {
  source: string;
  skillNames?: string[];
  all?: boolean;
  scope: "global" | "project";
  projectRoot?: string;
  method: "symlink" | "copy";
  harnesses?: string[];
  homeRoot: string;
  harnessdeckDir: string;
  dryRun?: boolean;
}

export interface AddSkillPackageResult {
  namespace: string;
  importedSkills: string[];
  installedSkills: string[];
  snapshotId: string;
  layer?: string;
}

function skillPackageHint(primary: string): string {
  return `Source is not a skill package (detected: ${primary}). Use a repo with skills/ or .agents/skills/ containing SKILL.md files.`;
}

function resolveSkillsToInstall(
  discovered: DiscoveredSkill[],
  options: Pick<AddSkillPackageOptions, "skillNames" | "all">,
): DiscoveredSkill[] {
  const discoveredNames = new Set(discovered.map((skill) => skill.name));

  if (options.all) {
    return discovered;
  }

  if (options.skillNames && options.skillNames.length > 0) {
    const missing = options.skillNames.filter((name) => !discoveredNames.has(name));
    if (missing.length > 0) {
      throw new Error(`Skill(s) not found: ${missing.join(", ")}`);
    }
    const selected = new Set(options.skillNames);
    return discovered.filter((skill) => selected.has(skill.name));
  }

  throw new Error(
    "No skills selected. Pass --skill <names>, --all, or use the wizard.",
  );
}

function resolveHarnessTargets(options: AddSkillPackageOptions): string[] {
  if (options.harnesses && options.harnesses.length > 0) {
    return options.harnesses;
  }
  return resolveScanGlobalHarnessTargets(undefined, options.homeRoot);
}

function updateSnapshotInstalledSkillNames(
  snapshotId: string,
  installedSkillNames: string[],
): void {
  const snapshot = getImportedSnapshot(snapshotId);
  if (!snapshot) return;

  const db = getDb();
  const metadata = {
    ...snapshot.metadata,
    installed_skill_names: installedSkillNames,
  };
  db.prepare("UPDATE imported_snapshots SET metadata = ? WHERE id = ?").run(
    JSON.stringify(metadata),
    snapshotId,
  );
}

export async function addSkillPackage(
  options: AddSkillPackageOptions,
): Promise<AddSkillPackageResult> {
  const resolved = resolveRemoteSource(options.source);
  let checkoutRoot: string;
  let gitUrl: string | undefined;
  let gitSha: string | undefined;

  if (resolved.kind === "git") {
    const cacheDir = sourceCacheDir(
      options.harnessdeckDir,
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

  const importedSkills = discovered.map((skill) => skill.name);
  const skillsToInstall = resolveSkillsToInstall(discovered, options);
  const installedSkillNames = skillsToInstall.map((skill) => skill.name);
  const namespace = resolved.label;

  if (options.dryRun) {
    return {
      namespace,
      importedSkills,
      installedSkills: installedSkillNames,
      snapshotId: "",
    };
  }

  const importResult = await importSkillPackage({
    rootPath: checkoutRoot,
    sourceLabel: namespace,
    gitUrl,
    gitSha,
  });

  const harnesses = resolveHarnessTargets(options);
  let installedSkills: string[];

  if (options.scope === "global") {
    const installResult = await installSkillsToGlobal({
      checkoutRoot,
      skills: skillsToInstall,
      harnesses,
      homeRoot: options.homeRoot,
      method: options.method,
    });
    installedSkills = installResult.installed;
    recordImportedSnapshotInstall({
      snapshot_id: importResult.snapshot.id,
      platform_id: "hub",
      files: installResult.files,
    });
  } else {
    const projectRoot = resolve(options.projectRoot ?? ".");
    const installResult = await installSkillsToProject({
      checkoutRoot,
      skills: skillsToInstall,
      harnesses,
      projectRoot,
      method: options.method,
    });
    installedSkills = installResult.installed;
    recordImportedSnapshotInstall({
      snapshot_id: importResult.snapshot.id,
      platform_id: "project",
      files: installResult.files,
    });
  }

  updateSnapshotInstalledSkillNames(importResult.snapshot.id, installedSkills);

  return {
    namespace,
    importedSkills,
    installedSkills,
    snapshotId: importResult.snapshot.id,
  };
}
