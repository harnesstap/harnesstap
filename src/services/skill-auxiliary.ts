import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SerializedFile, SkillMetadata } from "../types.js";

const IGNORED_DIR_NAMES = new Set([".git", "node_modules"]);
const SKILL_ENTRY_FILE = "SKILL.md";

function posixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function isIgnoredDirName(name: string): boolean {
  return name.startsWith(".") || IGNORED_DIR_NAMES.has(name);
}

function fileMode(mode: number): number {
  return mode & 0o777;
}

export function serializedContentFromBytes(bytes: Buffer): Pick<SerializedFile, "content" | "encoding"> {
  const asUtf8 = bytes.toString("utf8");
  if (Buffer.from(asUtf8, "utf8").equals(bytes)) {
    return { content: asUtf8 };
  }
  return { content: bytes.toString("base64"), encoding: "base64" };
}

export interface SkillCompanionEntry {
  relativePath: string;
  mode: number;
}

function walkSkillCompanions(
  skillDir: string,
  currentDir: string,
  entries: SkillCompanionEntry[],
): void {
  let names: string[];
  try {
    names = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const name of names) {
    if (name.startsWith(".")) continue;
    const fullPath = join(currentDir, name);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (isIgnoredDirName(name)) continue;
      walkSkillCompanions(skillDir, fullPath, entries);
      continue;
    }

    if (!stats.isFile()) continue;
    const relativePath = posixRelative(skillDir, fullPath);
    if (!relativePath || relativePath === SKILL_ENTRY_FILE) continue;
    if (relativePath.split("/").some((segment) => segment.startsWith("."))) continue;
    entries.push({
      relativePath,
      mode: fileMode(stats.mode),
    });
  }
}

export function listSkillCompanionTree(skillDir: string): SkillCompanionEntry[] {
  if (!existsSync(skillDir)) return [];
  try {
    if (!statSync(skillDir).isDirectory()) return [];
  } catch {
    return [];
  }

  const entries: SkillCompanionEntry[] = [];
  walkSkillCompanions(skillDir, skillDir, entries);
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function listRelativeFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    if (!statSync(dirPath).isDirectory()) return [];
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dirPath)) {
    if (entry.startsWith(".")) continue;
    const entryPath = join(dirPath, entry);
    try {
      if (statSync(entryPath).isFile()) {
        files.push(entry);
      }
    } catch {
    }
  }
  return files.sort();
}

function topLevelNamesUnder(companions: SkillCompanionEntry[], dirName: string): string[] {
  const prefix = `${dirName}/`;
  const names: string[] = [];
  for (const entry of companions) {
    if (!entry.relativePath.startsWith(prefix)) continue;
    const rest = entry.relativePath.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    names.push(rest);
  }
  return names.sort();
}

export function listSkillAuxiliaryFiles(skillDir: string): {
  scripts: string[];
  references: string[];
  companions: string[];
} {
  const companions = listSkillCompanionTree(skillDir);
  const scripts = topLevelNamesUnder(companions, "scripts");
  const references = [
    ...topLevelNamesUnder(companions, "reference"),
    ...topLevelNamesUnder(companions, "references"),
  ]
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
  return {
    scripts,
    references,
    companions: companions.map((entry) => entry.relativePath),
  };
}

export function skillMetadataFromDir(skillDir: string): SkillMetadata {
  const listed = listSkillAuxiliaryFiles(skillDir);
  const metadata: SkillMetadata = {};
  if (listed.scripts.length > 0) metadata.scripts = listed.scripts;
  if (listed.references.length > 0) metadata.references = listed.references;
  if (listed.companions.length > 0) metadata.companions = listed.companions;
  return metadata;
}

export function emitSkillAuxiliaryFiles(input: {
  sourceSkillDir: string;
  targetPrefix: string;
  scripts?: string[];
  references?: string[];
}): SerializedFile[] {
  const files: SerializedFile[] = [];
  const normalizedPrefix = input.targetPrefix.replace(/\/$/, "");
  const companions = listSkillCompanionTree(input.sourceSkillDir);

  for (const entry of companions) {
    const sourcePath = join(input.sourceSkillDir, ...entry.relativePath.split("/"));
    if (!existsSync(sourcePath)) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(sourcePath);
    } catch {
      continue;
    }
    files.push({
      path: `${normalizedPrefix}/${entry.relativePath}`,
      ...serializedContentFromBytes(bytes),
      mode: entry.mode,
    });
  }

  return files;
}
