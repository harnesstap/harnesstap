import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { ResourceType, RuleMetadata, SkillMetadata } from "../types.js";
import {
  BundleSymlinkError,
  listContainedRegularFiles,
} from "../utils/path-containment.js";
import { parseHooksJsonContent } from "./hook-serialization.js";
import { listSkillAuxiliaryFiles } from "./skill-auxiliary.js";

export const APM_NATIVE_PRIMITIVE_DIRS = ["agents", "skills", "commands", "hooks"] as const;
export const APM_APPLY_PRIMITIVE_DIRS = [
  ...APM_NATIVE_PRIMITIVE_DIRS,
  "instructions",
  "prompts",
] as const;
const APM_WARN_ONLY_DIRS = ["chatmodes", "mcp"] as const;

export type ApmNativePrimitiveDir = (typeof APM_NATIVE_PRIMITIVE_DIRS)[number];
export type ApmApplyPrimitiveDir = (typeof APM_APPLY_PRIMITIVE_DIRS)[number];

export interface ApmOverlaySkill {
  name: string;
  description: string;
  content: string;
  skillDirRelative: string;
  skillMdRelative: string;
  metadata: SkillMetadata;
}

export interface ApmOverlayPrimitive {
  type: ResourceType;
  name: string;
  description: string;
  content: string;
  metadata: Record<string, unknown>;
  sourceRelative: string;
}

export interface ApmOverlayInfo {
  present: boolean;
  fromApm: boolean;
  skills: ApmOverlaySkill[];
  primitives: ApmOverlayPrimitive[];
  skippedKinds: string[];
  skippedRootDirs: string[];
  warnings: string[];
}

export interface InspectApmOverlayOptions {
  exclude?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function skippedRootSourceWarning(dir: string): string {
  return (
    `Skipping root-level ${dir}/ because .apm/ is present. ` +
    `Move publishable files to .apm/${dir}/ or remove ${dir}/ to silence this warning.`
  );
}

function matchesExclude(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\.\//, "").replace(/\\/g, "/");
    if (normalized.endsWith("/**")) {
      const prefix = normalized.slice(0, -3);
      return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
    }
    if (normalized.endsWith("/*")) {
      const prefix = normalized.slice(0, -2);
      if (!relativePath.startsWith(`${prefix}/`)) return false;
      return !relativePath.slice(prefix.length + 1).includes("/");
    }
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

function listSourceFiles(
  projectRoot: string,
  sourceRelative: string,
  exclude: string[],
): string[] {
  const absolute = join(projectRoot, sourceRelative);
  if (!existsSync(absolute)) {
    return [];
  }
  if (lstatSync(absolute).isSymbolicLink()) {
    throw new BundleSymlinkError(sourceRelative);
  }
  if (!lstatSync(absolute).isDirectory()) {
    return [];
  }
  return listContainedRegularFiles(absolute)
    .filter((child) => !child.split("/").some((segment) => segment.startsWith(".")))
    .map((child) => `${sourceRelative}/${child}`)
    .filter((relativePath) => !matchesExclude(relativePath, exclude));
}

function nativeBasename(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? relativePath;
  return base.replace(/\.(agent|prompt|instructions)\.md$/i, "").replace(/\.md$/i, "");
}

function sourceDir(prefix: string, dir: string): string {
  return prefix ? `${prefix}/${dir}` : dir;
}

function parseMarkdown(
  projectRoot: string,
  relativePath: string,
): { data: Record<string, unknown>; content: string } {
  const raw = readFileSync(join(projectRoot, relativePath), "utf-8");
  const parsed = matter(raw);
  return {
    data: isRecord(parsed.data) ? { ...parsed.data } : {},
    content: parsed.content,
  };
}

function applyToGlobs(data: Record<string, unknown>): string[] {
  const raw = data.applyTo ?? data.apply_to;
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .map((entry) => entry.trim());
  }
  return [];
}

function skillFromPath(
  projectRoot: string,
  skillMdRelative: string,
): ApmOverlaySkill {
  const { data, content } = parseMarkdown(projectRoot, skillMdRelative);
  const skillDirRelative = skillMdRelative.replace(/\/SKILL\.md$/i, "");
  const dirName = skillDirRelative.split("/").pop() ?? "skill";
  const aux = listSkillAuxiliaryFiles(join(projectRoot, skillDirRelative));
  const metadata: SkillMetadata = {};
  if (aux.scripts.length > 0) metadata.scripts = aux.scripts;
  if (aux.references.length > 0) metadata.references = aux.references;
  return {
    name:
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : dirName,
    description: typeof data.description === "string" ? data.description : "",
    content: content.trim(),
    skillDirRelative,
    skillMdRelative,
    metadata,
  };
}

function markdownPrimitive(
  type: ResourceType,
  projectRoot: string,
  relativePath: string,
): ApmOverlayPrimitive {
  const { data, content } = parseMarkdown(projectRoot, relativePath);
  const name =
    typeof data.name === "string" && data.name.trim()
      ? data.name.trim()
      : nativeBasename(relativePath);
  const description = typeof data.description === "string" ? data.description : "";
  delete data.name;
  delete data.description;
  delete data.applyTo;
  delete data.apply_to;
  return {
    type,
    name,
    description,
    content: content.trim(),
    metadata: data,
    sourceRelative: relativePath,
  };
}

function collectSkills(
  projectRoot: string,
  skillsPrefix: string,
  exclude: string[],
): ApmOverlaySkill[] {
  const files = listSourceFiles(projectRoot, skillsPrefix, exclude);
  const skills: ApmOverlaySkill[] = [];
  const seen = new Set<string>();
  for (const relativePath of files) {
    if (!relativePath.endsWith("/SKILL.md") && relativePath !== `${skillsPrefix}/SKILL.md`) {
      continue;
    }
    const skill = skillFromPath(projectRoot, relativePath);
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    skills.push(skill);
  }
  return skills;
}

function collectMarkdownDir(
  type: ResourceType,
  projectRoot: string,
  dirRelative: string,
  exclude: string[],
): ApmOverlayPrimitive[] {
  const files = listSourceFiles(projectRoot, dirRelative, exclude);
  const primitives: ApmOverlayPrimitive[] = [];
  const seen = new Set<string>();
  for (const relativePath of files) {
    if (!relativePath.endsWith(".md")) continue;
    const primitive = markdownPrimitive(type, projectRoot, relativePath);
    const key = `${primitive.type}:${primitive.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    primitives.push(primitive);
  }
  return primitives;
}

function collectInstructions(
  projectRoot: string,
  dirRelative: string,
  exclude: string[],
): ApmOverlayPrimitive[] {
  const files = listSourceFiles(projectRoot, dirRelative, exclude);
  const primitives: ApmOverlayPrimitive[] = [];
  const seen = new Set<string>();
  for (const relativePath of files) {
    if (!relativePath.endsWith(".md")) continue;
    const { data, content } = parseMarkdown(projectRoot, relativePath);
    const name =
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : nativeBasename(relativePath);
    const description = typeof data.description === "string" ? data.description : "";
    const globs = applyToGlobs(data);
    const key = globs.length > 0 ? `rule:${name}` : `instruction:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (globs.length > 0) {
      const metadata: RuleMetadata = { globs, always_apply: false };
      primitives.push({
        type: "rule",
        name,
        description,
        content: content.trim(),
        metadata,
        sourceRelative: relativePath,
      });
      continue;
    }
    primitives.push({
      type: "instruction",
      name,
      description,
      content: content.trim(),
      metadata: {},
      sourceRelative: relativePath,
    });
  }
  return primitives;
}

function collectHooks(
  projectRoot: string,
  dirRelative: string,
  exclude: string[],
): ApmOverlayPrimitive[] {
  const files = listSourceFiles(projectRoot, dirRelative, exclude);
  const primitives: ApmOverlayPrimitive[] = [];
  const seen = new Set<string>();
  for (const relativePath of files) {
    if (!relativePath.endsWith(".json")) continue;
    const raw = readFileSync(join(projectRoot, relativePath), "utf-8");
    const parsed = parseHooksJsonContent(raw, relativePath);
    if (parsed.length > 0) {
      for (const resource of parsed) {
        const key = `hook:${resource.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        primitives.push({
          type: "hook",
          name: resource.name,
          description: resource.description,
          content: resource.content,
          metadata: isRecord(resource.metadata) ? { ...resource.metadata } : {},
          sourceRelative: relativePath,
        });
      }
      continue;
    }
    const name = relativePath
      .replace(/^.*\//, "")
      .replace(/\.json$/i, "")
      .replaceAll("/", "-") || "hook";
    const key = `hook:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    primitives.push({
      type: "hook",
      name,
      description: "",
      content: raw,
      metadata: {},
      sourceRelative: relativePath,
    });
  }
  return primitives;
}

function collectFromPrefix(
  projectRoot: string,
  prefix: string,
  exclude: string[],
  includeInstructionsAndPrompts: boolean,
): { skills: ApmOverlaySkill[]; primitives: ApmOverlayPrimitive[] } {
  const skills = collectSkills(projectRoot, sourceDir(prefix, "skills"), exclude);
  const primitives: ApmOverlayPrimitive[] = skills.map((skill) => ({
    type: "skill",
    name: skill.name,
    description: skill.description,
    content: skill.content,
    metadata: { ...skill.metadata },
    sourceRelative: skill.skillMdRelative,
  }));
  primitives.push(
    ...collectMarkdownDir("agent", projectRoot, sourceDir(prefix, "agents"), exclude),
  );
  primitives.push(
    ...collectMarkdownDir("command", projectRoot, sourceDir(prefix, "commands"), exclude),
  );
  primitives.push(
    ...collectHooks(projectRoot, sourceDir(prefix, "hooks"), exclude),
  );
  if (includeInstructionsAndPrompts) {
    primitives.push(
      ...collectInstructions(projectRoot, sourceDir(prefix, "instructions"), exclude),
    );
    primitives.push(
      ...collectMarkdownDir("command", projectRoot, sourceDir(prefix, "prompts"), exclude),
    );
  }
  const seen = new Set<string>();
  const unique: ApmOverlayPrimitive[] = [];
  for (const primitive of primitives) {
    const key = `${primitive.type}:${primitive.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(primitive);
  }
  return { skills, primitives: unique };
}

export function collectSkillMdFiles(
  rootPath: string,
  skillsDirRelative: string,
): ApmOverlaySkill[] {
  return collectSkills(rootPath, skillsDirRelative.split("\\").join("/"), []);
}

export function inspectApmOverlay(
  rootPath: string,
  options: InspectApmOverlayOptions = {},
): ApmOverlayInfo | undefined {
  const exclude = options.exclude ?? [];
  const apmDir = join(rootPath, ".apm");
  const apmPresent = existsSync(apmDir);
  const warnings: string[] = [];
  const skippedKinds: string[] = [];
  const skippedRootDirs: string[] = [];

  if (apmPresent) {
    if (lstatSync(apmDir).isSymbolicLink()) {
      throw new BundleSymlinkError(".apm");
    }
    const collected = collectFromPrefix(rootPath, ".apm", exclude, true);
    for (const dir of APM_NATIVE_PRIMITIVE_DIRS) {
      if (existsSync(join(rootPath, dir))) {
        skippedRootDirs.push(dir);
        warnings.push(skippedRootSourceWarning(dir));
      }
    }
    for (const dir of APM_WARN_ONLY_DIRS) {
      if (isDirectory(join(apmDir, dir))) {
        skippedKinds.push(`.apm/${dir}`);
        warnings.push(
          `Local .apm/${dir} primitives are present but not applied; MCP comes from apm.yml and chatmodes are not a HarnessTap resource type`,
        );
      }
    }
    if (collected.primitives.length === 0 && skippedKinds.length === 0) {
      const hasApplyDir = APM_APPLY_PRIMITIVE_DIRS.some((dir) => isDirectory(join(apmDir, dir)));
      if (!hasApplyDir && readdirSync(apmDir).filter((entry) => !entry.startsWith(".")).length === 0) {
        warnings.push("Local .apm/ directory is present but contains no primitives to apply");
      } else if (collected.primitives.length === 0) {
        warnings.push("Local .apm/ directory is present but contains no applyable primitives");
      }
    }
    return {
      present: true,
      fromApm: true,
      skills: collected.skills,
      primitives: collected.primitives,
      skippedKinds,
      skippedRootDirs,
      warnings,
    };
  }

  const rootHasNative = APM_NATIVE_PRIMITIVE_DIRS.some((dir) => existsSync(join(rootPath, dir)));
  if (!rootHasNative) {
    return undefined;
  }

  const collected = collectFromPrefix(rootPath, "", exclude, false);
  return {
    present: false,
    fromApm: false,
    skills: collected.skills,
    primitives: collected.primitives,
    skippedKinds,
    skippedRootDirs,
    warnings,
  };
}
