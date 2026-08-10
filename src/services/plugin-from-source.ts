import { resolve } from "node:path";
import {
  getImportedSnapshot,
  recordImportedSnapshotInstall,
} from "../models/imported-snapshot.js";
import { getDb } from "../db/connection.js";
import {
  createPlugin,
  deletePlugin,
  getPlugin,
  getPluginByName,
  getPluginResources,
} from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { resolveScanGlobalHarnessTargets } from "./harness-targets.js";
import { importSkillPackage } from "./skill-package-import.js";
import {
  installSkillsToGlobal,
  installSkillsToProject,
} from "./skill-install.js";
import { addPluginAttachment } from "./plugin-composition.js";
import {
  type PluginSourceConflictPolicy,
  resolveSelectedSkills,
  resolveSkillPackageCheckout,
} from "./skill-package-resolve.js";

export interface CreatePluginFromSourceOptions {
  name: string;
  source: string;
  version?: string;
  description?: string;
  tags?: string[];
  skillNames?: string[];
  all?: boolean;
  excludeCategories?: string[];
  onConflict?: PluginSourceConflictPolicy;
  install?: boolean;
  scope?: "global" | "project";
  projectRoot?: string;
  method?: "symlink" | "copy";
  harnesses?: string[];
  dryRun?: boolean;
  homeRoot: string;
  harnesstapDir: string;
}

export interface CreatePluginFromSourceResult {
  plugin: Plugin;
  namespace: string;
  importedSkills: string[];
  attachedSkills: string[];
  installedSkills: string[];
  conflictPolicy: PluginSourceConflictPolicy | "create";
  snapshotId: string;
}

function skillAttachmentKey(name: string, namespace: string): string {
  return `skill:${name}@${namespace}`;
}

function pluginHasSkillAttachment(
  pluginId: string,
  name: string,
  namespace: string,
): boolean {
  const resources = getPluginResources(pluginId);
  return resources.some(
    (resource) =>
      resource.type === "skill"
      && resource.name === name
      && resource.namespace === namespace,
  );
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

function resolveHarnessTargets(
  harnesses: string[] | undefined,
  homeRoot: string,
): string[] {
  if (harnesses && harnesses.length > 0) {
    return harnesses;
  }
  return resolveScanGlobalHarnessTargets(undefined, homeRoot);
}

async function attachSkillsToPlugin(
  plugin: Plugin,
  namespace: string,
  skillNames: string[],
): Promise<string[]> {
  const attached: string[] = [];
  for (const skillName of skillNames) {
    if (pluginHasSkillAttachment(plugin.id, skillName, namespace)) {
      continue;
    }
    await addPluginAttachment({
      plugin,
      selector: skillAttachmentKey(skillName, namespace),
      type: "skill",
    });
    attached.push(skillName);
  }
  return attached;
}

function resolvePluginForConflict(input: {
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  onConflict: PluginSourceConflictPolicy;
}): { plugin: Plugin; conflictPolicy: PluginSourceConflictPolicy | "create" } {
  const existing = getPluginByName(input.name, input.version);
  if (!existing) {
    const plugin = createPlugin({
      name: input.name,
      version: input.version,
      description: input.description,
      tags: input.tags,
    });
    return { plugin, conflictPolicy: "create" };
  }

  switch (input.onConflict) {
    case "merge":
      return { plugin: existing, conflictPolicy: "merge" };
    case "overwrite": {
      const preservedDescription =
        input.description !== undefined && input.description !== ""
          ? input.description
          : existing.description;
      deletePlugin(existing.id);
      const plugin = createPlugin({
        name: input.name,
        version: input.version,
        description: preservedDescription,
        tags: input.tags ?? existing.tags,
      });
      return { plugin, conflictPolicy: "overwrite" };
    }
    default:
      throw new Error(
        `Plugin already exists: ${input.name}@${input.version}. Pass --on-conflict merge or --on-conflict overwrite.`,
      );
  }
}

export async function createPluginFromSource(
  options: CreatePluginFromSourceOptions,
): Promise<CreatePluginFromSourceResult> {
  const version = options.version ?? "1.0.0";
  const onConflict = options.onConflict ?? "cancel";
  const method = options.method ?? "symlink";

  const resolved = resolveSkillPackageCheckout(
    options.source,
    options.harnesstapDir,
  );
  const skillsToAttach = resolveSelectedSkills(resolved.discovered, {
    skillNames: options.skillNames,
    all: options.all,
    excludeCategories: options.excludeCategories,
  });
  const attachedSkillNames = skillsToAttach.map((skill) => skill.name);
  const importedSkills = resolved.discovered.map((skill) => skill.name);

  if (options.dryRun) {
    const existing = getPluginByName(options.name, version);
    const conflictPolicy: PluginSourceConflictPolicy | "create" = existing
      ? onConflict === "cancel"
        ? "cancel"
        : onConflict
      : "create";
    if (existing && onConflict === "cancel") {
      throw new Error(
        `Plugin already exists: ${options.name}@${version}. Pass --on-conflict merge or --on-conflict overwrite.`,
      );
    }

    return {
      plugin: existing ?? {
        id: "dry-run",
        name: options.name,
        version,
        org_slug: "",
        catalog_slug: "",
        origin: "authored",
        description: options.description ?? "",
        tags: options.tags ?? [],
        dirty: false,
        created_at: "",
        updated_at: "",
      },
      namespace: resolved.namespace,
      importedSkills,
      attachedSkills: attachedSkillNames,
      installedSkills: options.install ? attachedSkillNames : [],
      conflictPolicy,
      snapshotId: "",
    };
  }

  const { plugin, conflictPolicy } = resolvePluginForConflict({
    name: options.name,
    version,
    description: options.description,
    tags: options.tags,
    onConflict,
  });

  const importResult = await importSkillPackage({
    rootPath: resolved.checkoutRoot,
    sourceLabel: resolved.namespace,
    gitUrl: resolved.gitUrl,
    gitSha: resolved.gitSha,
  });

  const attachedSkills = await attachSkillsToPlugin(
    plugin,
    resolved.namespace,
    attachedSkillNames,
  );

  let installedSkills: string[] = [];
  if (options.install) {
    if (!options.scope) {
      throw new Error("Scope required when --install is set. Pass --global or --project.");
    }

    const harnesses = resolveHarnessTargets(options.harnesses, options.homeRoot);
    if (options.scope === "global") {
      const installResult = await installSkillsToGlobal({
        checkoutRoot: resolved.checkoutRoot,
        skills: skillsToAttach,
        harnesses,
        homeRoot: options.homeRoot,
        method,
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
        skills: skillsToAttach,
        harnesses,
        projectRoot,
        method,
      });
      installedSkills = installResult.installed;
      recordImportedSnapshotInstall({
        snapshot_id: importResult.snapshot.id,
        platform_id: "project",
        files: installResult.files,
      });
    }
    updateSnapshotInstalledSkillNames(importResult.snapshot.id, installedSkills);
  }

  const finalized = getPlugin(plugin.name);
  if (!finalized) {
    throw new Error(`Failed to resolve plugin after create: ${options.name}`);
  }

  return {
    plugin: finalized,
    namespace: resolved.namespace,
    importedSkills,
    attachedSkills,
    installedSkills,
    conflictPolicy,
    snapshotId: importResult.snapshot.id,
  };
}
