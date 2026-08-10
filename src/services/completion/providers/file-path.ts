import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CompletionCandidate, CompletionContext } from "../types.js";
import { filterByPrefix } from "../utils.js";

export type FilePathCompletionMode = "file" | "directory" | "plugin-import";

function listPathCandidates(
  prefix: string,
  mode: FilePathCompletionMode,
): CompletionCandidate[] {
  const resolvedPrefix = resolve(prefix || ".");
  const directory = dirname(resolvedPrefix);
  const baseName = resolvedPrefix === directory
    ? ""
    : resolvedPrefix.slice(directory.length + 1);

  if (!existsSync(directory)) {
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }

  const candidates: CompletionCandidate[] = [];
  for (const entry of entries) {
    if (!entry.startsWith(baseName)) {
      continue;
    }
    const fullPath = join(directory, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }

    if (mode === "directory" && !isDirectory) {
      continue;
    }
    if (mode === "plugin-import" && !isDirectory) {
      const lower = entry.toLowerCase();
      if (!lower.endsWith(".toml") && !lower.endsWith(".jsonc")) {
        continue;
      }
    }

    const value = directory === process.cwd()
      ? join(entry)
      : fullPath;
    candidates.push({ value });
  }

  return candidates;
}

export function completeFilePath(ctx: CompletionContext): CompletionCandidate[] {
  return filterByPrefix(listPathCandidates(ctx.prefix, "file"), ctx.prefix);
}

export function completeDirectoryPath(ctx: CompletionContext): CompletionCandidate[] {
  return filterByPrefix(listPathCandidates(ctx.prefix, "directory"), ctx.prefix);
}

export function completePluginImportPath(ctx: CompletionContext): CompletionCandidate[] {
  return filterByPrefix(listPathCandidates(ctx.prefix, "plugin-import"), ctx.prefix);
}
