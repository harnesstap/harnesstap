import { mkdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { SerializedFile } from "../types.js";
import { materializeFromSource, replaceWithRelativeSymlink } from "./link-materialize.js";
import type { PluginResourceMode } from "./plugin-resource-mode.js";

const INSTRUCTION_BASENAMES = new Set(["AGENTS.md", "CLAUDE.md"]);

export interface InstructionLink {
  path: string;
  target: string;
}

export interface PairedInstructionFiles {
  files: SerializedFile[];
  links: InstructionLink[];
}

function posixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function instructionBasename(path: string): string {
  return basename(posixPath(path));
}

function isInstructionFile(path: string): boolean {
  return INSTRUCTION_BASENAMES.has(instructionBasename(path));
}

function normalizeInstructionContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function pickCanonical(group: readonly SerializedFile[]): SerializedFile {
  const agents = group.find((file) => instructionBasename(file.path) === "AGENTS.md");
  if (agents) return agents;
  const first = group[0];
  if (!first) {
    throw new Error("instruction group is empty");
  }
  return first;
}

/**
 * When CLAUDE.md and AGENTS.md would hold the same text, keep AGENTS.md as
 * the real file. Claude Code 2.1.277+ reads CLAUDE.md when that path exists
 * and ignores AGENTS.md by default, so a CLAUDE.md → AGENTS.md link gives
 * Claude the shared text without a second load. OpenCode reads AGENTS.md.
 *
 * `copy` keeps independent files. `symlink` links CLAUDE.md at AGENTS.md.
 * `clone` uses copy-on-write (falls back to copy).
 */
export function pairInstructionFiles(
  files: readonly SerializedFile[],
  mode: PluginResourceMode,
): PairedInstructionFiles {
  if (mode === "copy") {
    return { files: [...files], links: [] };
  }

  const instruction = files.filter((file) => isInstructionFile(file.path));
  if (instruction.length < 2) {
    return { files: [...files], links: [] };
  }

  const rest = files.filter((file) => !isInstructionFile(file.path));
  const groups = new Map<string, SerializedFile[]>();
  for (const file of instruction) {
    const key = normalizeInstructionContent(file.content);
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }

  const filesOut: SerializedFile[] = [...rest];
  const links: InstructionLink[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      const only = group[0];
      if (only) filesOut.push(only);
      continue;
    }
    const canonical = pickCanonical(group);
    filesOut.push(canonical);
    for (const file of group) {
      if (posixPath(file.path) === posixPath(canonical.path)) continue;
      links.push({
        path: posixPath(file.path),
        target: posixPath(canonical.path),
      });
    }
  }

  return { files: filesOut, links };
}

export function applyInstructionLinks(
  rootPath: string,
  links: readonly InstructionLink[],
  mode: PluginResourceMode,
): void {
  if (mode === "copy" || links.length === 0) return;

  for (const link of links) {
    const dest = join(rootPath, link.path);
    const canonical = join(rootPath, link.target);
    mkdirSync(dirname(dest), { recursive: true });
    switch (mode) {
      case "symlink": {
        const relativeTarget = relative(dirname(dest), canonical) || basename(canonical);
        replaceWithRelativeSymlink(dest, relativeTarget);
        break;
      }
      case "clone":
        materializeFromSource(dest, canonical, "clone");
        break;
      default: {
        const exhaustive: never = mode;
        throw new Error(`Unsupported instruction link mode: ${exhaustive}`);
      }
    }
  }
}
