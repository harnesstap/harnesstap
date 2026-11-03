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

/** Where `block` sits as a whole `## name` section, or -1. */
function blockIndex(content: string, block: string): number {
  for (let at = content.indexOf(block); at >= 0; at = content.indexOf(block, at + 1)) {
    const after = content.slice(at + block.length);
    const startsLine = at === 0 || content[at - 1] === "\n";
    const endsSection = after.trim() === "" || after.startsWith("\n\n");
    if (startsLine && endsSection) return at;
  }
  return -1;
}

/**
 * Takes HarnessTap's own rule blocks out of a `.roomodes` the user also
 * edited. Returns the content left, or undefined when a recorded block is not
 * found verbatim (then nothing is touched).
 */
function stripConcatenatedRuleBlocks(
  content: string,
  resourceIds: readonly string[],
): string | undefined {
  let remaining = content.replace(/\r\n/g, "\n");
  const resources = getResourcesByIds([...resourceIds]);
  if (resources.length !== resourceIds.length) return undefined;
  for (const resource of resources) {
    const block = `## ${resource.name}\n\n${resource.content}`;
    const at = blockIndex(remaining, block);
    if (at < 0) return undefined;
    remaining = remaining.slice(0, at) + remaining.slice(at + block.length);
  }
  return remaining.replace(/\n{3,}/g, "\n\n").trim();
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
      const kept = stripConcatenatedRuleBlocks(readFileSync(fullPath, "utf-8"), resourceIds);
      if (kept) {
        backupAndRewriteFile({
          rootPath,
          relativePath: path,
          nextContent: `${kept}\n`,
          applyId,
          snapshotId: options.snapshotId,
        });
        deleteMaterializationsForRootPaths(rootPath, [path]);
        result.rewritten.push(path);
        result.warnings.push(
          `removed HarnessTap rules from ${path} and kept your content (${emit.hint})`,
        );
        continue;
      }
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
