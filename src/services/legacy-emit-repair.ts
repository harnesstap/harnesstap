import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import type { SerializedFile } from "../types.js";
import { getResourcesByIds } from "../models/resource.js";
import {
  deleteMaterializationsForRootPaths,
  listMaterializationsForRoot,
} from "../models/resource-materialization.js";
import { isPreexistingPath } from "../models/preexisting-path.js";
import {
  backupAndRewriteFile,
  classifyManagedPathOwnership,
  executeSafeFileRemovals,
} from "./safe-file-removal.js";

/**
 * Files earlier HarnessTap versions wrote to places a harness never read.
 * - Roo rules were concatenated into `.roomodes`, the custom modes file:
 *   https://roocodeinc.github.io/Roo-Code/features/custom-modes/
 * - Antigravity commands went to workflow folders that stopped working on
 *   2026-10-19: https://antigravity.google/docs/migration/workflows-to-skills
 */
interface LegacyEmit {
  platformId: string;
  matches: (relativePath: string) => boolean;
  /** Folder scanned for files HarnessTap never wrote, to warn about them. */
  unmanagedDir?: string;
  /** How earlier versions joined rule blocks into one file. */
  concatenatedRules?: boolean;
  hint: string;
}

const WORKFLOW_HINT =
  "Antigravity no longer reads workflows; run /migrate-workflows in Antigravity to turn it into a skill";

const LEGACY_EMITS: readonly LegacyEmit[] = [
  {
    platformId: "roo",
    matches: (path) => path === ".roomodes",
    concatenatedRules: true,
    hint: "Roo rules now live in .roo/rules/",
  },
  ...[".agents/workflows/", ".gemini/config/global_workflows/", ".gemini/config/workflows/"].map(
    (dir): LegacyEmit => ({
      platformId: "antigravity",
      matches: (path) => path.startsWith(dir),
      unmanagedDir: dir,
      hint: WORKFLOW_HINT,
    }),
  ),
];

export interface LegacyEmitRepairResult {
  removed: string[];
  rewritten: string[];
  warnings: string[];
}

function legacyEmitFor(platformId: string, path: string): LegacyEmit | undefined {
  return LEGACY_EMITS.find((emit) => emit.platformId === platformId && emit.matches(path));
}

function listMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter(
      (name) => name.endsWith(".md") && statSync(join(dir, name)).isFile(),
    );
  } catch {
    return [];
  }
}

/** Line starts of `#` and `##` headings, the levels that end a `##` section. */
function topHeadingStarts(content: string): number[] {
  const starts: number[] = [];
  const pattern = /^#{1,2}(?:[ \t]|$)/gm;
  for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
    starts.push(match.index);
    pattern.lastIndex = match.index + 1;
  }
  return starts;
}

/**
 * Where `block` sits as a whole section: from its heading through the line
 * before the next heading of the same or higher level (or EOF), matching
 * byte for byte except for trailing whitespace. -1 when no section matches,
 * so a paragraph the user added under it keeps the section out of reach.
 */
function sectionIndex(content: string, block: string): number {
  const span = Math.max(1, topHeadingStarts(block).length);
  const starts = topHeadingStarts(content);
  for (let i = 0; i < starts.length; i++) {
    const at = starts[i] as number;
    const end = starts[i + span] ?? content.length;
    if (content.slice(at, end).trimEnd() === block.trimEnd()) return at;
  }
  return -1;
}

interface RuleSectionStrip {
  kept: string;
  stripped: string[];
  skipped: string[];
}

/**
 * Takes HarnessTap's own rule sections out of a `.roomodes` the user also
 * edited. A section that no longer matches what HarnessTap wrote stays in
 * the file and is reported as skipped.
 */
function stripConcatenatedRuleBlocks(
  content: string,
  resourceIds: readonly string[],
): RuleSectionStrip {
  let remaining = content.replace(/\r\n/g, "\n");
  const resources = getResourcesByIds([...resourceIds]);
  const stripped: string[] = [];
  const skipped: string[] = [];
  for (const resource of resources) {
    const block = `## ${resource.name}\n\n${resource.content}`;
    const at = sectionIndex(remaining, block);
    if (at < 0) {
      skipped.push(resource.name);
      continue;
    }
    const end = at + block.trimEnd().length;
    remaining = remaining.slice(0, at) + remaining.slice(end);
    stripped.push(resource.name);
  }
  if (resources.length < resourceIds.length) skipped.push("(unknown rule)");
  return { kept: remaining.replace(/\n{3,}/g, "\n\n").trim(), stripped, skipped };
}

/**
 * Backs up and removes files HarnessTap wrote to retired harness paths.
 * Only manifest rows with a matching on-disk hash are removed; edited,
 * preexisting, and unmanaged files are kept with a warning. A `.roomodes`
 * the user also edited keeps the user's part.
 */
export function repairLegacyHarnessEmits(
  rootPath: string,
  files: readonly SerializedFile[],
  options: { applyId?: string; snapshotId?: string } = {},
): LegacyEmitRepairResult {
  const result: LegacyEmitRepairResult = { removed: [], rewritten: [], warnings: [] };
  const desired = new Set(files.map((file) => file.path));
  const rowsByPath = new Map<string, { emit: LegacyEmit; resourceIds: string[] }>();
  for (const row of listMaterializationsForRoot(rootPath)) {
    if (desired.has(row.path)) continue;
    const emit = legacyEmitFor(row.platform_id, row.path);
    if (!emit) continue;
    const entry = rowsByPath.get(row.path) ?? { emit, resourceIds: [] };
    if (!entry.resourceIds.includes(row.resource_id)) entry.resourceIds.push(row.resource_id);
    rowsByPath.set(row.path, entry);
  }

  const applyId = options.applyId ?? ulid();
  const removable: string[] = [];
  for (const [path, { emit, resourceIds }] of rowsByPath) {
    const fullPath = join(rootPath, path);
    if (!existsSync(fullPath)) {
      deleteMaterializationsForRootPaths(rootPath, [path]);
      continue;
    }
    if (
      emit.concatenatedRules &&
      !isPreexistingPath(rootPath, path) &&
      classifyManagedPathOwnership(rootPath, path) === "modified"
    ) {
      const strip = stripConcatenatedRuleBlocks(readFileSync(fullPath, "utf-8"), resourceIds);
      if (strip.skipped.length > 0) {
        result.warnings.push(
          `kept rule section${strip.skipped.length === 1 ? "" : "s"} ${strip.skipped.join(", ")} in ${path}: changed since HarnessTap wrote ${strip.skipped.length === 1 ? "it" : "them"} (${emit.hint})`,
        );
      }
      if (strip.stripped.length > 0 && strip.kept) {
        backupAndRewriteFile({
          rootPath,
          relativePath: path,
          nextContent: `${strip.kept}\n`,
          applyId,
          snapshotId: options.snapshotId,
        });
        deleteMaterializationsForRootPaths(rootPath, [path]);
        result.rewritten.push(path);
        result.warnings.push(
          `removed HarnessTap rules from ${path} and kept your content (${emit.hint})`,
        );
      }
      if (strip.stripped.length > 0 && !strip.kept) {
        result.warnings.push(`kept ${path}: only whitespace changed since HarnessTap wrote it (${emit.hint})`);
      }
      // An edited file is never removed whole here; keep it and move on.
      continue;
    }
    removable.push(path);
  }

  if (removable.length > 0) {
    const removal = executeSafeFileRemovals(rootPath, removable, {
      applyId,
      snapshotId: options.snapshotId,
    });
    result.removed.push(...removal.removed);
    for (const skip of removal.skipped) {
      if (skip.reason === "missing") continue;
      const emit = rowsByPath.get(skip.path)?.emit;
      result.warnings.push(`${skip.message}${emit ? ` (${emit.hint})` : ""}`);
    }
  }

  // Only folders HarnessTap wrote to before, so a user's own workflows do not
  // warn on every apply.
  const tracked = new Set(rowsByPath.keys());
  const touchedEmits = new Set([...rowsByPath.values()].map((entry) => entry.emit));
  for (const emit of touchedEmits) {
    if (!emit.unmanagedDir) continue;
    const dir = emit.unmanagedDir;
    const unmanaged = listMarkdownFiles(join(rootPath, dir)).filter(
      (name) => !tracked.has(`${dir}${name}`),
    );
    if (unmanaged.length === 0) continue;
    result.warnings.push(
      `kept ${unmanaged.length} file${unmanaged.length === 1 ? "" : "s"} in ${dir} HarnessTap did not write (${emit.hint})`,
    );
  }
  return result;
}

/** Runs the repair and prints its warnings, as other apply cleanups do. */
export function repairLegacyHarnessEmitsWithWarnings(
  rootPath: string,
  files: readonly SerializedFile[],
): void {
  for (const warning of repairLegacyHarnessEmits(rootPath, files).warnings) {
    console.error(`warning: ${warning}`);
  }
}
