import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import matter from "gray-matter";
import { createImportedSnapshot } from "../models/imported-snapshot.js";
import { normalizeResourceInput, upsertResource } from "../models/resource.js";
import type {
  ImportedResourceProvenance,
  ImportedSnapshot,
  Resource,
  ResourceCreateInput,
  SkillMetadata,
} from "../types.js";
import { discoverSkillPackage, type DiscoveredSkill } from "./skill-discovery.js";
import { listSkillAuxiliaryFiles } from "./skill-auxiliary.js";

export interface ImportSkillPackageResult {
  snapshot: ImportedSnapshot;
  resources: Resource[];
}

export interface ImportSkillPackageOptions {
  rootPath: string;
  sourceLabel: string;
  gitUrl?: string;
  gitSha?: string;
  pluginDisplayName?: string;
}

function assertSafeResourceName(name: string, filePath: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    isAbsolute(trimmed)
  ) {
    throw new Error(`Invalid imported resource name in ${filePath}: ${name}`);
  }
  return trimmed;
}

function resolvePluginDisplayName(
  sourceLabel: string,
  pluginDisplayName?: string,
): string {
  if (pluginDisplayName?.trim()) {
    return pluginDisplayName.trim();
  }
  const segment = sourceLabel.split("/").pop();
  return segment?.trim() || sourceLabel;
}

function buildCategoriesMap(skills: DiscoveredSkill[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {};
  for (const skill of skills) {
    let bucket = categories[skill.category];
    if (!bucket) {
      bucket = [];
      categories[skill.category] = bucket;
    }
    bucket.push(skill.name);
  }
  for (const names of Object.values(categories)) {
    names.sort((a, b) => a.localeCompare(b));
  }
  return categories;
}

function buildProvenance(input: {
  importedAt: string;
  sourceLabel: string;
  pluginName: string;
  relativePath: string;
}): ImportedResourceProvenance {
  return {
    source_kind: "skill-package",
    source_label: input.sourceLabel,
    plugin_name: input.pluginName,
    source_plugin_kind: "skill-package",
    relative_path: input.relativePath,
    imported_at: input.importedAt,
  };
}

function buildSkillResource(input: {
  rootPath: string;
  skill: DiscoveredSkill;
  sourceLabel: string;
  pluginName: string;
  importedAt: string;
}): ResourceCreateInput {
  const skillPath = join(input.rootPath, input.skill.skillMdRelative);
  const raw = readFileSync(skillPath, "utf-8");
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch {
    throw new Error(`Malformed resource frontmatter: ${skillPath}`);
  }
  if (raw.startsWith("---") && parsed.content === raw) {
    throw new Error(`Malformed resource frontmatter: ${skillPath}`);
  }

  const skillDir = join(input.rootPath, input.skill.skillDirRelative);
  const provenance = buildProvenance({
    importedAt: input.importedAt,
    sourceLabel: input.sourceLabel,
    pluginName: input.pluginName,
    relativePath: input.skill.skillMdRelative,
  });
  const { scripts, references } = listSkillAuxiliaryFiles(skillDir);
  const metadata: SkillMetadata & { imported_from: ImportedResourceProvenance } = {
    scripts,
    references,
    imported_from: provenance,
  };

  return {
    type: "skill",
    name: assertSafeResourceName(
      (typeof parsed.data.name === "string" && parsed.data.name.trim()
        ? parsed.data.name
        : input.skill.name),
      skillPath,
    ),
    description:
      typeof parsed.data.description === "string" ? parsed.data.description : "",
    content: parsed.content.trim(),
    source: input.skill.skillMdRelative,
    metadata,
  };
}

export async function importSkillPackage(
  options: ImportSkillPackageOptions,
): Promise<ImportSkillPackageResult> {
  const { rootPath, sourceLabel, gitUrl, gitSha, pluginDisplayName } = options;
  const skills = discoverSkillPackage(rootPath);
  if (skills.length === 0) {
    throw new Error(`No skills found in skill package: ${rootPath}`);
  }

  const pluginName = resolvePluginDisplayName(sourceLabel, pluginDisplayName);
  const importedAt = new Date().toISOString();
  const originRef = `${sourceLabel}@${gitSha ?? "local"}`;

  const resourceInputs = skills.map((skill) =>
    buildSkillResource({
      rootPath,
      skill,
      sourceLabel,
      pluginName,
      importedAt,
    }),
  );

  const resources: Resource[] = [];
  const resourceIds: string[] = [];

  for (const resource of resourceInputs) {
    const upserted = upsertResource(
      normalizeResourceInput({
        ...resource,
        namespace: sourceLabel,
        origin_kind: "local_snapshot",
        origin_ref: originRef,
      }),
      { policy: "overwrite" },
    );

    const saved =
      upserted.action === "skipped" ? upserted.existing : upserted.resource;
    resourceIds.push(saved.id);
    resources.push(saved);
  }

  const snapshot = createImportedSnapshot({
    source_kind: "skill-package",
    source_label: sourceLabel,
    plugin_name: pluginName,
    resource_ids: resourceIds,
    metadata: {
      git_url: gitUrl,
      git_sha: gitSha,
      categories: buildCategoriesMap(skills),
    },
  });

  return { snapshot, resources };
}
