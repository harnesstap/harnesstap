import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getAllPlatforms } from "../platforms/registry.js";
import type { DiscoveredSkill } from "./skill-discovery.js";

export type SkillInstallMethod = "symlink" | "copy";

function resolveConfiguredPath(baseRoot: string, configured: string): string {
  return configured.startsWith("~/")
    ? join(baseRoot, configured.slice(2))
    : join(baseRoot, configured);
}

function resolveGlobalSkillPath(homeRoot: string, platformId: string): string | undefined {
  const platform = getAllPlatforms().find((p) => p.id === platformId);
  const configured = platform?.globalPaths.skills;
  if (!configured) return undefined;
  return resolveConfiguredPath(homeRoot, configured);
}

function resolveProjectSkillPath(projectRoot: string, platformId: string): string | undefined {
  const platform = getAllPlatforms().find((p) => p.id === platformId);
  const configured = platform?.projectPaths.skills;
  if (!configured) return undefined;
  return join(projectRoot, configured);
}

function ensureSymlink(linkPath: string, targetPath: string): void {
  mkdirSync(dirname(linkPath), { recursive: true });
  if (existsSync(linkPath)) {
    rmSync(linkPath, { recursive: true, force: true });
  }
  symlinkSync(resolve(targetPath), linkPath);
}

function installSkillAtPath(
  linkPath: string,
  targetPath: string,
  method: SkillInstallMethod,
): void {
  if (method === "copy") {
    mkdirSync(linkPath, { recursive: true });
    cpSync(targetPath, linkPath, { recursive: true });
    return;
  }
  ensureSymlink(linkPath, targetPath);
}

function resolveEffectiveMethod(
  method: SkillInstallMethod,
  materializationStrategy?: "symlink-preferred" | "copy",
): SkillInstallMethod {
  if (materializationStrategy === "copy") {
    return "copy";
  }
  if (materializationStrategy === "symlink-preferred") {
    return "symlink";
  }
  return method;
}

function relativeFromRoot(root: string, absolutePath: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absolutePath.startsWith(prefix)
    ? absolutePath.slice(prefix.length)
    : relative(root, absolutePath);
}

export async function installSkillsToGlobal(options: {
  checkoutRoot: string;
  skills: DiscoveredSkill[];
  harnesses: string[];
  homeRoot: string;
  method: SkillInstallMethod;
}): Promise<{ installed: string[]; files: string[] }> {
  const installed: string[] = [];
  const files: string[] = [];

  for (const skill of options.skills) {
    const sourceDir = join(options.checkoutRoot, skill.skillDirRelative);
    const hubDir = join(options.homeRoot, ".agents/skills", skill.name);

    installSkillAtPath(hubDir, sourceDir, options.method);
    files.push(join(".agents/skills", skill.name));
    installed.push(skill.name);

    for (const harness of options.harnesses) {
      const targetRoot = resolveGlobalSkillPath(options.homeRoot, harness);
      if (!targetRoot) continue;
      const targetDir = join(targetRoot, skill.name);
      if (targetDir === hubDir) continue;
      installSkillAtPath(targetDir, hubDir, options.method);
      files.push(relativeFromRoot(options.homeRoot, targetDir));
    }
  }

  return { installed, files };
}

export async function installSkillsToProject(options: {
  checkoutRoot: string;
  skills: DiscoveredSkill[];
  harnesses: string[];
  projectRoot: string;
  method: SkillInstallMethod;
  materializationStrategy?: "symlink-preferred" | "copy";
}): Promise<{ installed: string[]; files: string[] }> {
  const effectiveMethod = resolveEffectiveMethod(options.method, options.materializationStrategy);
  const installed: string[] = [];
  const files: string[] = [];

  for (const skill of options.skills) {
    const sourceDir = join(options.checkoutRoot, skill.skillDirRelative);
    const hubDir = join(options.projectRoot, ".agents/skills", skill.name);

    installSkillAtPath(hubDir, sourceDir, effectiveMethod);
    files.push(join(".agents/skills", skill.name));
    installed.push(skill.name);

    for (const harness of options.harnesses) {
      const targetRoot = resolveProjectSkillPath(options.projectRoot, harness);
      if (!targetRoot) continue;
      const targetDir = join(targetRoot, skill.name);
      if (targetDir === hubDir) continue;
      installSkillAtPath(targetDir, hubDir, effectiveMethod);
      files.push(relativeFromRoot(options.projectRoot, targetDir));
    }
  }

  return { installed, files };
}
