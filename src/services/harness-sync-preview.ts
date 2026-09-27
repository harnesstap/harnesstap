import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { SerializedFile, SerializerTarget } from "../types.js";
import type { ApplyResult } from "./applier.js";
import { fileContentsEquivalentForDrift } from "./file-contents-drift.js";
import {
  nativeSkillDir,
  type SkillHubPlan,
} from "./host-plugin-material.js";
import type { InstructionLink, PairedInstructionFiles } from "./instruction-file-links.js";
import type { PluginResourceMode } from "./plugin-resource-mode.js";
import { skillConsumeDirs } from "./shared-emit-paths.js";

export interface HarnessSyncChangeCount {
  harness: string;
  changes: number;
}

export interface CountHarnessSyncChangesInput {
  platforms: readonly string[];
  results: readonly ApplyResult[];
  paired: PairedInstructionFiles;
  skillHubPlans: readonly SkillHubPlan[];
  target: SerializerTarget;
  rootPath: string;
  pluginResourceMode: PluginResourceMode;
}

function posix(path: string): string {
  return path.replace(/\\/g, "/");
}

function filesByPlatform(
  results: readonly ApplyResult[],
): Map<string, Map<string, SerializedFile>> {
  const byPlatform = new Map<string, Map<string, SerializedFile>>();
  for (const result of results) {
    let files = byPlatform.get(result.platformId);
    if (!files) {
      files = new Map();
      byPlatform.set(result.platformId, files);
    }
    for (const file of result.files) {
      const path = posix(file.path);
      files.set(path, { ...file, path });
    }
  }
  return byPlatform;
}

function linkExists(fullPath: string): boolean {
  try {
    lstatSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

function isSymlink(fullPath: string): boolean {
  try {
    return lstatSync(fullPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function serializedWouldChange(rootPath: string, file: SerializedFile): boolean {
  const fullPath = join(rootPath, file.path);
  if (!existsSync(fullPath)) return true;
  try {
    const current = readFileSync(fullPath, "utf8");
    return !fileContentsEquivalentForDrift(file.path, current, file.content);
  } catch {
    return true;
  }
}

function symlinkWouldChange(rootPath: string, link: InstructionLink): boolean {
  const dest = join(rootPath, link.path);
  const canonical = join(rootPath, link.target);
  const expected = posix(relative(dirname(dest), canonical) || basename(canonical));
  if (!linkExists(dest)) return true;
  if (!isSymlink(dest)) return true;
  try {
    return posix(readlinkSync(dest)) !== expected;
  } catch {
    return true;
  }
}

function cloneWouldChange(
  rootPath: string,
  link: InstructionLink,
  paired: PairedInstructionFiles,
): boolean {
  const dest = join(rootPath, link.path);
  const expected =
    paired.files.find((file) => posix(file.path) === link.target)?.content ??
    (existsSync(join(rootPath, link.target))
      ? readFileSync(join(rootPath, link.target), "utf8")
      : null);
  if (expected === null) return !existsSync(dest);
  if (!existsSync(dest) || isSymlink(dest)) return true;
  try {
    return !fileContentsEquivalentForDrift(
      link.path,
      readFileSync(dest, "utf8"),
      expected,
    );
  } catch {
    return true;
  }
}

function linkWouldChange(
  rootPath: string,
  link: InstructionLink,
  mode: PluginResourceMode,
  paired: PairedInstructionFiles,
): boolean {
  switch (mode) {
    case "copy":
      return false;
    case "symlink":
      return symlinkWouldChange(rootPath, link);
    case "clone":
      return cloneWouldChange(rootPath, link, paired);
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function hubWouldChange(rootPath: string, plan: SkillHubPlan): boolean {
  const dest = join(rootPath, plan.skillMdPath);
  const source = join(plan.sourceDir, "SKILL.md");
  if (!existsSync(dest)) return true;
  if (!existsSync(source)) return true;
  try {
    return !fileContentsEquivalentForDrift(
      plan.skillMdPath,
      readFileSync(dest, "utf8"),
      readFileSync(source, "utf8"),
    );
  } catch {
    return true;
  }
}

function planBelongsToHarness(
  plan: SkillHubPlan,
  platformId: string,
  target: SerializerTarget,
): boolean {
  const dest = `${posix(plan.destDir).replace(/\/+$/, "")}/`;
  for (const dir of skillConsumeDirs(platformId, target)) {
    if (dest.startsWith(dir)) return true;
  }
  const native = nativeSkillDir(platformId, target);
  return Boolean(native && dest.startsWith(native));
}

function pathWouldChange(
  relPath: string,
  platformFiles: Map<string, SerializedFile>,
  paired: PairedInstructionFiles,
  hubs: Map<string, SkillHubPlan>,
  rootPath: string,
  mode: PluginResourceMode,
): boolean {
  const link = paired.links.find((entry) => entry.path === relPath);
  if (link) {
    return linkWouldChange(rootPath, link, mode, paired);
  }
  const file =
    paired.files.find((entry) => posix(entry.path) === relPath) ??
    platformFiles.get(relPath);
  if (file) {
    return serializedWouldChange(rootPath, file);
  }
  const hub = hubs.get(relPath);
  if (hub) {
    return hubWouldChange(rootPath, hub);
  }
  return !existsSync(join(rootPath, relPath));
}

/**
 * Count files that would actually change on disk, grouped by the harness
 * that would emit or consume them.
 */
export function countHarnessSyncChanges(
  input: CountHarnessSyncChangesInput,
): HarnessSyncChangeCount[] {
  const byPlatform = filesByPlatform(input.results);
  const hubs = new Map(
    input.skillHubPlans.map((plan) => [posix(plan.skillMdPath), plan]),
  );

  return input.platforms.map((harness) => {
    const files = byPlatform.get(harness) ?? new Map();
    const paths = new Set(files.keys());
    for (const link of input.paired.links) {
      if (files.has(link.path)) paths.add(link.path);
    }
    for (const plan of input.skillHubPlans) {
      if (planBelongsToHarness(plan, harness, input.target)) {
        paths.add(posix(plan.skillMdPath));
      }
    }

    let changes = 0;
    for (const path of paths) {
      if (
        pathWouldChange(
          path,
          files,
          input.paired,
          hubs,
          input.rootPath,
          input.pluginResourceMode,
        )
      ) {
        changes += 1;
      }
    }
    return { harness, changes };
  });
}
