import {
  type BlockedHostPluginViewFiles,
  type KeptHostPluginViewFiles,
  type ReplacedHostPluginViewFiles,
  replaceKeptHostPluginViewFiles,
  takeBlockedHostPluginViewFiles,
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
  takeBlocked?: () => BlockedHostPluginViewFiles[];
}

function defaultDeps(): SettleKeptHostPluginViewDeps {
  return {
    interactive: canPromptInteractively(),
    confirm: promptForConfirmation,
    take: takeKeptHostPluginViewFiles,
    takeReplaced: takeReplacedHostPluginViewFiles,
    replace: replaceKeptHostPluginViewFiles,
    takeBlocked: takeBlockedHostPluginViewFiles,
  };
}

function describeBlocker(file: BlockedHostPluginViewFiles["files"][number]): string {
  if (file.kind === "folder") return `${file.path} (a folder is at that path)`;
  const what = file.kind === "link" ? "a link" : "a file";
  return `${file.path} (${file.blockedBy} is ${what}, where the plugin needs a folder)`;
}

/** Plugin files a refresh could not write: say what is in the way, and fail the command. */
export function announceBlocked(entry: BlockedHostPluginViewFiles): string {
  const where = shortenHomePath(entry.hostView);
  const listed = entry.files.slice(0, LISTED_FILES).map(describeBlocker);
  const more = entry.files.length - listed.length;
  const names = more > 0 ? `${listed.join(", ")}, and ${more} more` : listed.join(", ");
  return `Could not write ${formatCount(entry.files.length, "plugin file")} in ${where}: ${names}. `
    + "HarnessTap does not remove or write through them, so the plugin there is incomplete. "
    + "Move them away, then run the command again.";
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
  const removed = new Set(entry.removed ?? []);
  const theirs = entry.notWrittenByHarnessTap;
  const verb = removed.size === 0
    ? "replaced"
    : removed.size === entry.files.length
      ? "removed"
      : "replaced or removed";
  const count = formatCount(entry.files.length, "file");
  let what = `${count} in ${where}: ${listPaths(entry.files)}`;
  if (theirs.length === entry.files.length) {
    what = `${count} in ${where} that changed since HarnessTap wrote them: ${listPaths(theirs)}`;
  } else if (theirs.length > 0) {
    what += `. Of those, changed since HarnessTap wrote them: ${listPaths(theirs)}`;
  }
  if (removed.size > 0 && removed.size < entry.files.length) {
    what += `. Removed because the plugin no longer has them: ${listPaths([...removed])}`;
  } else if (removed.size > 0) {
    what += ". The plugin no longer has them";
  }
  return `Backed up and ${verb} ${what}.${restoreHint(entry.backupId)}`;
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
function describeChange(files: KeptHostPluginViewFiles["files"]): string {
  const missing = files.filter((file) => file.inPlugin === false).length;
  const differing = files.length - missing;
  const parts: string[] = [];
  if (differing > 0) parts.push(`replace ${formatCount(differing, "file")} with the plugin's version`);
  if (missing > 0) {
    parts.push(`remove ${differing > 0 ? missing : formatCount(missing, "file")} the plugin does not have`);
  }
  return parts.join(" and ");
}

const NEVER_THEIRS = "HarnessTap never replaces or removes files it did not write, even with --force-remove.";

/**
 * A host plugin refresh keeps files in `~/.claude/plugins/cache/...` that
 * HarnessTap did not write or that changed since. Files that changed since
 * HarnessTap wrote them can be replaced: ask in a terminal, otherwise say
 * how. Files HarnessTap did not write are never replaced or removed.
 */
export async function settleKeptHostPluginViewFiles(
  options: { json?: boolean } = {},
  deps: SettleKeptHostPluginViewDeps = defaultDeps(),
): Promise<void> {
  for (const entry of deps.takeReplaced()) {
    // stderr, so --format json output stays clean.
    console.error(announceReplaced(entry));
  }
  for (const entry of deps.takeBlocked?.() ?? []) {
    // stderr, so --format json output stays clean.
    console.error(`⚠ ${announceBlocked(entry)}`);
    process.exitCode = 1;
  }
  for (const entry of deps.take()) {
    // Shown once per change: the same kept files were reported last time.
    if (entry.alreadyReported) continue;
    const where = shortenHomePath(entry.hostView);
    const count = formatCount(entry.files.length, "file");
    const changed = entry.files.filter((file) => file.reason === "modified");
    const theirs = entry.files.length - changed.length;
    const changedCount = formatCount(changed.length, "file");
    const which = theirs > 0 ? `up the ${changedCount} you changed` : "them up";
    if (deps.interactive && !options.json && changed.length > 0) {
      ui.warn(`Kept ${count} in ${where} that differ from the plugin: ${describeFiles(entry)}.`);
      const confirmed = await deps.confirm({
        message: theirs > 0
          ? `Back up the ${changedCount} you changed in ${where}, then ${describeChange(changed)}?`
          : `Back up the ${count} in ${where}, then ${describeChange(changed)}?`,
        default: false,
      });
      if (confirmed) {
        const { paths, backupId } = deps.replace(entry);
        const kept = theirs > 0 ? ` ${NEVER_THEIRS}` : "";
        ui.success(
          `Backed up and replaced ${formatCount(paths.length, "file")} in ${where}.${restoreHint(backupId)}${kept}`,
        );
        continue;
      }
    }
    const howToReplace = changed.length > 0
      ? ` To back ${which}, then ${describeChange(changed)}, run the command again with --force-remove.`
      : "";
    const never = theirs > 0 ? ` ${NEVER_THEIRS}` : "";
    // stderr, so --format json output stays clean.
    console.error(
      `Kept ${count} in ${where} that differ from the plugin: ${describeFiles(entry)}.${howToReplace}${never}`,
    );
  }
}
