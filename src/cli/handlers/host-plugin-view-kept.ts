import {
  type KeptHostPluginViewFiles,
  type ReplacedHostPluginViewFiles,
  replaceKeptHostPluginViewFiles,
  takeKeptHostPluginViewFiles,
  takeReplacedHostPluginViewFiles,
} from "../../services/package-cache/host-plugin.js";
import { promptForConfirmation } from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { shortenHomePath } from "../../utils/home-path.js";
import { formatCount } from "../formatting.js";
import { formatCommand } from "../shared.js";
import { canPromptInteractively } from "./plugin-auto-update.js";

const LISTED_FILES = 5;

export interface SettleKeptHostPluginViewDeps {
  interactive: boolean;
  confirm: (input: { message: string; default?: boolean }) => Promise<boolean>;
  take: () => KeptHostPluginViewFiles[];
  takeReplaced: () => ReplacedHostPluginViewFiles[];
  replace: (entry: KeptHostPluginViewFiles) => { paths: string[]; backupId?: string };
}

function defaultDeps(): SettleKeptHostPluginViewDeps {
  return {
    interactive: canPromptInteractively(),
    confirm: promptForConfirmation,
    take: takeKeptHostPluginViewFiles,
    takeReplaced: takeReplacedHostPluginViewFiles,
    replace: replaceKeptHostPluginViewFiles,
  };
}

function listPaths(paths: readonly string[]): string {
  const listed = paths.slice(0, LISTED_FILES);
  const more = paths.length - listed.length;
  return more > 0 ? `${listed.join(", ")}, and ${more} more` : listed.join(", ");
}

function restoreHint(backupId: string | undefined): string {
  return backupId
    ? ` To put the old files back, run \`${formatCommand(["revert", backupId])}\`.`
    : "";
}

/**
 * Say which files a host plugin refresh replaced or removed and how to put
 * them back. Every one was backed up first.
 */
function announceReplaced(entry: ReplacedHostPluginViewFiles): string {
  const where = shortenHomePath(entry.hostView);
  const count = formatCount(entry.files.length, "file");
  const theirs = entry.notWrittenByHarnessTap;
  let what = `${count} in ${where}: ${listPaths(entry.files)}`;
  if (theirs.length === entry.files.length) {
    what = `${count} in ${where} that HarnessTap did not write or that changed since: ${listPaths(theirs)}`;
  } else if (theirs.length > 0) {
    what += `. Of those, HarnessTap did not write or you changed: ${listPaths(theirs)}`;
  }
  return `Backed up and replaced ${what}.${restoreHint(entry.backupId)}`;
}

function describeFiles(entry: KeptHostPluginViewFiles): string {
  const listed = entry.files.slice(0, LISTED_FILES).map((file) => {
    const why = file.reason === "modified" ? "changed since HarnessTap wrote it" : "not written by HarnessTap";
    return `${file.path} (${file.inPlugin === false ? `${why}, not in the plugin` : why})`;
  });
  const more = entry.files.length - listed.length;
  return more > 0 ? `${listed.join(", ")}, and ${more} more` : listed.join(", ");
}

/** "replace 1 file with the plugin's version and remove 2 the plugin does not have" */
function describeChange(entry: KeptHostPluginViewFiles): string {
  const missing = entry.files.filter((file) => file.inPlugin === false).length;
  const differing = entry.files.length - missing;
  const parts: string[] = [];
  if (differing > 0) parts.push(`replace ${formatCount(differing, "file")} with the plugin's version`);
  if (missing > 0) {
    parts.push(`remove ${differing > 0 ? missing : formatCount(missing, "file")} the plugin does not have`);
  }
  return parts.join(" and ");
}

/**
 * A host plugin refresh keeps files in `~/.claude/plugins/cache/...` that
 * HarnessTap did not write or that changed since. Ask before replacing them
 * in a terminal; otherwise say they were kept and how to replace them.
 */
export async function settleKeptHostPluginViewFiles(
  options: { json?: boolean } = {},
  deps: SettleKeptHostPluginViewDeps = defaultDeps(),
): Promise<void> {
  for (const entry of deps.takeReplaced()) {
    // stderr, so --format json output stays clean.
    console.error(announceReplaced(entry));
  }
  for (const entry of deps.take()) {
    // Shown once per change: the same kept files were reported last time.
    if (entry.alreadyReported) continue;
    const where = shortenHomePath(entry.hostView);
    const count = formatCount(entry.files.length, "file");
    if (deps.interactive && !options.json) {
      ui.warn(`Kept ${count} in ${where} that differ from the plugin: ${describeFiles(entry)}.`);
      const confirmed = await deps.confirm({
        message: `Back up the ${count} in ${where}, then ${describeChange(entry)}?`,
        default: false,
      });
      if (confirmed) {
        const { backupId } = deps.replace(entry);
        ui.success(`Backed up and replaced ${count} in ${where}.${restoreHint(backupId)}`);
        continue;
      }
    }
    // stderr, so --format json output stays clean.
    console.error(
      `Kept ${count} in ${where} that differ from the plugin: ${describeFiles(entry)}. To back them up, then ${describeChange(entry)}, run the command again with --force-remove.`,
    );
  }
}
