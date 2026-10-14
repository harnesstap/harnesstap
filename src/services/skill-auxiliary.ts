import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SerializedFile, SkillMetadata } from "../types.js";
import { computationSlot } from "./status-computation.js";

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

interface CompanionContent {
  relativePath: string;
  mode: number;
  content: string;
  encoding?: SerializedFile["encoding"];
}

interface CachedCompanionFile {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  ino: number;
  content: string;
  encoding?: SerializedFile["encoding"];
}

// Companion bytes keyed by source path, reused while the file's stat
// identity is unchanged. Bounded by total content length.
const COMPANION_CACHE_MAX_CHARS = 64 * 1024 * 1024;
const companionFileCache = new Map<string, CachedCompanionFile>();
let companionCacheChars = 0;

export function clearSkillCompanionCache(): void {
  companionFileCache.clear();
  companionCacheChars = 0;
}

function forgetCompanion(sourcePath: string): void {
  const previous = companionFileCache.get(sourcePath);
  if (!previous) return;
  companionFileCache.delete(sourcePath);
  companionCacheChars -= previous.content.length;
}

function readCompanionContent(sourcePath: string): Pick<SerializedFile, "content" | "encoding"> | undefined {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(sourcePath);
  } catch {
    forgetCompanion(sourcePath);
    return undefined;
  }
  const cached = companionFileCache.get(sourcePath);
  if (
    cached
    && cached.mtimeMs === stats.mtimeMs
    && cached.ctimeMs === stats.ctimeMs
    && cached.size === stats.size
    && cached.ino === stats.ino
  ) {
    return cached.encoding ? { content: cached.content, encoding: cached.encoding } : { content: cached.content };
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(sourcePath);
  } catch {
    forgetCompanion(sourcePath);
    return undefined;
  }
  const serialized = serializedContentFromBytes(bytes);
  forgetCompanion(sourcePath);
  // Only cache bytes the stat describes; a write between stat and read
  // would otherwise pin stale content to the new identity.
  if (bytes.length === stats.size && serialized.content.length <= COMPANION_CACHE_MAX_CHARS / 8) {
    companionFileCache.set(sourcePath, {
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      size: stats.size,
      ino: stats.ino,
      ...serialized,
    });
    companionCacheChars += serialized.content.length;
    while (companionCacheChars > COMPANION_CACHE_MAX_CHARS) {
      const oldest = companionFileCache.keys().next().value;
      if (oldest === undefined) break;
      forgetCompanion(oldest);
    }
  }
  return serialized;
}

function loadSkillCompanions(sourceSkillDir: string): CompanionContent[] {
  const loaded: CompanionContent[] = [];
  for (const entry of listSkillCompanionTree(sourceSkillDir)) {
    const sourcePath = join(sourceSkillDir, ...entry.relativePath.split("/"));
    const serialized = readCompanionContent(sourcePath);
    if (!serialized) continue;
    loaded.push({ relativePath: entry.relativePath, mode: entry.mode, ...serialized });
  }
  return loaded;
}

export function emitSkillAuxiliaryFiles(input: {
  sourceSkillDir: string;
  targetPrefix: string;
  scripts?: string[];
  references?: string[];
}): SerializedFile[] {
  const normalizedPrefix = input.targetPrefix.replace(/\/$/, "");
  // Every harness emits the same source tree. Within one status
  // computation, walk and read it once.
  const companions = computationSlot(
    `skill-companions:${input.sourceSkillDir}`,
    () => loadSkillCompanions(input.sourceSkillDir),
  );
  return companions.map((entry) => ({
    path: `${normalizedPrefix}/${entry.relativePath}`,
    content: entry.content,
    ...(entry.encoding ? { encoding: entry.encoding } : {}),
    mode: entry.mode,
  }));
}
