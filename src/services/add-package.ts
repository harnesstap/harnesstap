import { resolve } from "node:path";
import {
  getImportedSnapshot,
  recordImportedSnapshotInstall,
} from "../models/imported-snapshot.js";
import { getDb } from "../db/connection.js";
import { resolveScanGlobalHarnessTargets } from "./harness-targets.js";
import { importSkillPackage } from "./skill-package-import.js";
import {
  installSkillsToGlobal,
  installSkillsToProject,
} from "./skill-install.js";
import {
  createLayer,
  getLayer,
} from "../models/layer-model.js";
import { addLayerAttachment } from "./layer-composition.js";
import {
  resolveSelectedSkills,
  resolveSkillPackageCheckout,
} from "./skill-package-resolve.js";

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
  createLayer?: string;
  layer?: string;
  dryRun?: boolean;
}

export interface AddSkillPackageResult {
  namespace: string;
  importedSkills: string[];
  installedSkills: string[];
  snapshotId: string;
  layer?: string;
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
  const resolved = resolveSkillPackageCheckout(
    options.source,
    options.harnessdeckDir,
  );

  const importedSkills = resolved.discovered.map((skill) => skill.name);
  const skillsToInstall = resolveSelectedSkills(resolved.discovered, options);
  const installedSkillNames = skillsToInstall.map((skill) => skill.name);
  const namespace = resolved.namespace;

  if (options.dryRun) {
    return {
      namespace,
      importedSkills,
      installedSkills: installedSkillNames,
      snapshotId: "",
    };
  }

  const importResult = await importSkillPackage({
    rootPath: resolved.checkoutRoot,
    sourceLabel: namespace,
    gitUrl: resolved.gitUrl,
    gitSha: resolved.gitSha,
  });

  const harnesses = resolveHarnessTargets(options);
  let installedSkills: string[];

  if (options.scope === "global") {
    const installResult = await installSkillsToGlobal({
      checkoutRoot: resolved.checkoutRoot,
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
      checkoutRoot: resolved.checkoutRoot,
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

  let attachedLayer: string | undefined;
  const layerName = options.createLayer ?? options.layer;
  if (layerName) {
    const targetLayer = options.createLayer
      ? createLayer({ name: options.createLayer })
      : getLayer(layerName);
    if (!targetLayer) {
      throw new Error(`Layer not found: ${options.layer}`);
    }

    for (const skillName of installedSkills) {
      await addLayerAttachment({
        layer: targetLayer,
        selector: `skill:${skillName}@${namespace}`,
        type: "skill",
      });
    }
    attachedLayer = targetLayer.name;
  }

  return {
    namespace,
    importedSkills,
    installedSkills,
    snapshotId: importResult.snapshot.id,
    ...(attachedLayer ? { layer: attachedLayer } : {}),
  };
}
