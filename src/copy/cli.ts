/**
 * User-facing CLI copy. ASCII punctuation only (DS-6).
 * Command hints always start with `ht`.
 */

import { pluralNoun } from "./plurals.js";

export const DRY_RUN_NOTHING_CHANGED = "Dry run. Nothing was changed.";

export const NATIVE_MODULE_MISMATCH_MESSAGE =
  "HarnessTap was installed under a different Node.js version. Run: npm rebuild -g harnesstap";

/** better-sqlite3 is optional (#501): Bun uses bun:sqlite, so an install may skip it. */
export const SQLITE_MODULE_MISSING_MESSAGE =
  "HarnessTap could not load its SQLite module (better-sqlite3), which did not install for this Node.js. Reinstall on Node 22.12 or newer: npm install -g harnesstap. Or run it on Bun: bun x --bun harnesstap@latest";

/** Quote a user-provided token so a pasted hint parses as one Commander argument. */
export function quoteCliArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (/^[A-Za-z0-9_./:@+=-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatHtCommand(path: string): string {
  return `ht ${path}`.trim();
}

export function quoted(name: string): string {
  return `"${name}"`;
}

export function skippedInvalidPluginExport(name: string): string {
  return `Warning: Skipped plugin ${quoted(name)}. Its version is not valid semver.`;
}

export function marketplaceUnreachable(source: string): string {
  return `Error: Couldn't reach ${source}.`;
}

export function marketplaceUnreachableHint(): string {
  return "Check the URL, or sign in with ht github login if it's private.";
}

export function marketplacePathMissing(path: string): string {
  return `Error: Couldn't find a marketplace at ${quoted(path)}.`;
}

export function marketplacePathNotMarketplace(path: string): string {
  return `Error: ${quoted(path)} is not a marketplace. It needs a marketplace.json file.`;
}

export function marketplaceAddFailedNothingSaved(): string {
  return "Nothing was saved.";
}

export function installPinnedPluginsPrompt(names: string[]): string {
  if (names.length === 1) {
    const only = names[0];
    return `Install pinned plugin ${quoted(only ?? "")} into the package cache?`;
  }
  return `Install ${String(names.length)} pinned plugins into the package cache?`;
}

export function installPinnedPluginsNeedsYes(): string {
  return "Error: Pass --yes to install pinned plugins without a prompt.";
}

export function installPinnedPluginsHint(profileName?: string): string {
  if (profileName) {
    return `Run ht profile use ${quoted(profileName)} --yes to install them.`;
  }
  return "Run ht profile use --yes to install them.";
}

export function missingMarketplacePluginHint(pluginName: string): string {
  return `Run ht profile use to install ${quoted(pluginName)}.`;
}

export function skippedHostPluginHook(hookName: string): string {
  return `Skipped hook ${hookName}. It only works when the plugin is installed as a host plugin.`;
}

export function skippedDuplicateCommand(name: string): string {
  return `Skipped command ${quoted(name)}. A skill already uses that name.`;
}

/** Quote a user-provided name in error text (DS-6). */
export function quoteName(name: string): string {
  return `"${name.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function hintToken(value: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]+$/.test(value)) {
    return value;
  }
  return quoteName(value);
}

/** `ht` plus shell-quoted arguments. Names with spaces stay one token. */
export function formatHtArgs(args: readonly string[]): string {
  return ["ht", ...args.map(hintToken)].join(" ");
}

/** Turn markdown links into terminal text. Relative targets keep the label only. */
export function plainTerminalText(value: string): string {
  return value.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, label: string, target: string) => {
      if (target.startsWith("http://") || target.startsWith("https://")) {
        return `${label} (${target})`;
      }
      return label;
    },
  );
}

export function ensureErrorPrefix(message: string): string {
  const stripped = message.replace(/^error:\s*/i, "").trim();
  if (stripped.length === 0) {
    return "Error: Something went wrong.";
  }
  const sentence = /[.!?]$/.test(stripped) ? stripped : `${stripped}.`;
  return `Error: ${sentence}`;
}

export function ensureWarningPrefix(message: string): string {
  const stripped = message.replace(/^warning:\s*/i, "").trim();
  const sentence = /[.!?]$/.test(stripped) ? stripped : `${stripped}.`;
  return `Warning: ${sentence}`;
}

export const CLI_HINTS = {
  seeOptions: (commandPath: string): string =>
    commandPath.trim().length > 0
      ? `Run ht ${commandPath.trim()} --help to see the options.`
      : "Run ht --help to see the options.",
  pluginList: "Run ht plugin list to see your plugins.",
  resourceList: "Run ht resource list to see your resources.",
  profileUseExample: 'For example: ht profile use "global default"',
  authLogin: "Run ht auth login to sign in.",
  githubLogin: marketplaceUnreachableHint(),
  onConflictReplace: "Use --on-conflict replace to replace it.",
  unsavedChanges: "Run again with --changes save, stash or discard.",
  updateNpm: "Update with: npm i -g harnesstap",
  mcpSearch: (name: string): string => `Run ht mcp search ${hintToken(name)} to find it.`,
  scopeAdd: (name: string, harnesses: string): string =>
    `Run ht resource scope ${hintToken(name)} --add ${hintToken(harnesses)}.`,
  portableMcpTip: (name: string, harnessList: string, command: string): string =>
    `Tip: ${quoteName(name)} also works on ${harnessList}. Run ${command}.`,
  forceRemove: "To remove them too, run the command again with --force-remove.",
  forceRemoveAlreadyUsed: "HarnessTap never removes these, even with --force-remove.",
  revert: "Snapshot saved. Undo with: ht revert",
  stashPop: "Bring them back with: ht profile stash pop",
  harnessSet: "Run ht harness set to pick your harnesses.",
  harnessSetOrFlag: "Run ht harness set, or pass --harness <slugs>.",
} as const;

export const CLI_ERRORS = {
  pluginNotFound: (name: string): string => `No plugin named ${quoteName(name)}.`,
  resourceNotFound: (name: string): string => `No resource named ${quoteName(name)}.`,
  invalidResourceType: (value: string, valid: readonly string[]): string =>
    `${quoteName(value)} isn't a resource type. Valid: ${valid.join(", ")}.`,
  conflictingResourceTypes: (a: string, b: string): string =>
    `Conflicting type filters: ${quoteName(a)} and ${quoteName(b)}.`,
  pluginAlreadyExists: (name: string): string =>
    `A plugin named ${quoteName(name)} already exists.`,
  environmentAlreadyExists: (name: string): string =>
    `An environment named ${quoteName(name)} already exists.`,
  notAuthenticated: "Not authenticated to HarnessTap Cloud.",
  directoryNotFound: (path: string): string => `Directory not found: ${path}.`,
  fileNotFound: (path: string): string => `File not found: ${path}.`,
  gitUnreachable: (url: string): string => `Couldn't reach ${url}.`,
  gitUnreachableGeneric: "Couldn't reach that git repository.",
  uniqueConstraintGeneric: "That name already exists.",
  missingProfileName: "Pass a profile name.",
  noProfileNamed: (name: string): string => `No profile named ${quoteName(name)}.`,
  invalidPluginName: (name: string): string =>
    `${quoteName(name)} isn't a valid plugin name. Use a non-empty name without /, \\, .. or control characters.`,
  emptyPluginName: "Pass a plugin name.",
  invalidFormat: (value: string): string => `Invalid --format value: ${value}. Use human or json.`,
  mcpNotInLibrary: (name: string): string => `${quoteName(name)} isn't in your library.`,
  newerSchema: "This data was saved by a newer HarnessTap.",
  noHarnesses: "Not set up for any harness yet.",
  unsavedChanges: (name: string, count: number): string =>
    `${quoteName(name)} has ${count} unsaved change${count === 1 ? "" : "s"}.`,
  resourceSyncFailed: (refs: readonly string[]): string =>
    `Could not install ${[...new Set(refs)].join(", ")}.`,
  resourceSyncStale: (count: number): string =>
    `${count} linked resource${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} stale.`,
} as const;

export const SCOPE_COPY = {
  allHarnesses: "Applies to all your harnesses",
  notSetUp: "Not set up for any harness yet",
} as const;

export const SWITCH_CHANGES_VALUES = ["save", "stash", "discard"] as const;
export type SwitchChangesValue = (typeof SWITCH_CHANGES_VALUES)[number];

export const SWITCH_CHANGES_FLAG_HELP =
  "What to do with unsaved changes: save, stash or discard";

export const DEVICE_LOGIN_WAITING =
  "Waiting for you to approve in the browser. The code expires in 15 minutes. Press Ctrl+C to cancel.";

export function initPickHarnessesLine(): string {
  return `Pick your harnesses: ${formatHtCommand("harness set")}`;
}

export function initCompletionHintLine(
  shell: "bash" | "zsh" | "fish" | undefined,
): string {
  switch (shell) {
    case "bash":
      return `Enable tab completion: ${formatHtCommand("init completion bash >> ~/.bashrc")}`;
    case "zsh":
      return `Enable tab completion: ${formatHtCommand("init completion zsh >> ~/.zshrc")}`;
    case "fish":
      return `Enable tab completion: ${formatHtCommand("init completion fish > ~/.config/fish/completions/ht.fish")}`;
    default:
      return `Enable tab completion: ${formatHtCommand("init completion <bash|zsh|fish>")}`;
  }
}

export const CLI_COPY = {
  dryRunNothingChanged: DRY_RUN_NOTHING_CHANGED,
  everythingUpToDate: "Everything is up to date.",
  snapshotSavedUndo: "Snapshot saved. Undo with:",
  keptYouChanged: "you changed it",
  keptClaudeChanged: "Claude Code changed it",
  keptNotMade: "not made by HarnessTap",
  viewSnapshot: "View snapshot",
  keptFilesIntro: "you changed or that HarnessTap didn't create:",
} as const;

export function alreadyExistsOnConflictHint(kind: string, name: string): string {
  return `A ${kind} named "${name}" already exists. Use --on-conflict replace to replace it.`;
}

/**
 * Hint after a cancelled apply. One file says "it"; two or more say "them".
 */
export function onConflictReplaceHint(conflicts: readonly string[]): string {
  const count = new Set(
    conflicts.map((path) => path.trim()).filter((path) => path.length > 0),
  ).size;
  if (count > 1) {
    return "Use --on-conflict replace to replace them.";
  }
  return CLI_HINTS.onConflictReplace;
}

/**
 * Human line for a cancelled apply. Names every conflicting path.
 * Pair with onConflictReplaceHint.
 */
export function applyCancelledMessage(
  conflicts: readonly string[],
  scope: "profile" | "apply" = "apply",
): string {
  const paths = [
    ...new Set(
      conflicts.map((path) => path.trim()).filter((path) => path.length > 0),
    ),
  ];
  const lead = scope === "profile" ? "Profile apply cancelled." : "Apply cancelled.";
  if (paths.length === 0) {
    return lead;
  }
  const listed = paths.map((path) => quoteCliArg(path)).join(", ");
  if (paths.length === 1) {
    return `${lead} ${listed} would change.`;
  }
  return `${lead} These files would change: ${listed}.`;
}

export function unsavedChangesLine(profileName: string, count: number): string {
  return CLI_ERRORS.unsavedChanges(profileName, count);
}

export function unsavedChangesFlagHint(): string {
  return CLI_HINTS.unsavedChanges;
}

export function savedChangesLine(profileName: string, count: number): string {
  return `Saved ${count} ${pluralNoun(count, "change")} to ${quoteName(profileName)}.`;
}

export function stashedChangesLine(count: number, popCommand: string): string {
  return `Stashed ${count} ${pluralNoun(count, "change")}. Bring ${count === 1 ? "it" : "them"} back with: ${popCommand}`;
}

export function discardedChangesLine(count: number): string {
  return `Discarded ${count} ${pluralNoun(count, "change")}.`;
}

export function discardConfirm(count: number): string {
  return `Discard ${count} ${pluralNoun(count, "change")}? A snapshot keeps a copy.`;
}

export const PREVIEW_LABELS = {
  willWrite: "Will write",
  upToDate: "Up to date",
  notInProfile: "Not in profile",
  willRemove: "Will remove",
  keptChanged: "Kept. You changed it.",
  keptUnmanaged: "Kept. Not made by HarnessTap.",
  dryRunHeader: DRY_RUN_NOTHING_CHANGED,
  everythingUpToDate: (unchanged: number): string => `Everything is up to date. ${unchanged} unchanged.`,
} as const;

export function applyWroteLine(input: {
  wrote: number;
  removed: number;
  kept: number;
  unchanged?: number;
  omitUnchanged?: boolean;
}): string {
  if (input.wrote === 0 && input.removed === 0 && input.kept === 0) {
    return input.unchanged !== undefined
      ? `${CLI_COPY.everythingUpToDate} ${input.unchanged} unchanged.`
      : CLI_COPY.everythingUpToDate;
  }
  if (input.wrote === 0 && input.removed === 0) {
    const line = `Wrote 0, removed 0, kept ${input.kept}`;
    if (!input.omitUnchanged && input.unchanged !== undefined && input.unchanged > 0) {
      return `${line}, unchanged ${input.unchanged}.`;
    }
    return `${line}.`;
  }
  const parts: string[] = [];
  if (input.wrote > 0) parts.push(`Wrote ${input.wrote}`);
  if (input.removed > 0) parts.push(`removed ${input.removed}`);
  if (input.kept > 0) parts.push(`kept ${input.kept}`);
  if (parts.length === 0) {
    return input.unchanged !== undefined
      ? `${CLI_COPY.everythingUpToDate} ${input.unchanged} unchanged.`
      : CLI_COPY.everythingUpToDate;
  }
  if (!input.omitUnchanged && input.unchanged !== undefined && input.unchanged > 0) {
    parts.push(`unchanged ${input.unchanged}`);
  }
  const [first, ...rest] = parts;
  const head = first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}` : "";
  if (rest.length === 0) {
    return `${head}.`;
  }
  return `${head}, ${rest.join(", ")}.`;
}

export function applyHeaderLine(profileName: string, harnessCount: number): string {
  const noun = harnessCount === 1 ? "harness" : "harnesses";
  return `Applied "${profileName}" to ${harnessCount} ${noun}.`;
}

export function dryRunWouldLine(input: {
  write: number;
  remove: number;
  keep: number;
  unchanged: number;
}): string {
  return `Would write ${input.write}, remove ${input.remove}, keep ${input.keep}. ${input.unchanged} unchanged.`;
}

export function dryRunStashLine(count: number, profileName: string): string {
  return `Dry run. Would stash ${count} ${pluralNoun(count, "change")} from "${profileName}".`;
}

export function snapshotSavedUndoLine(revertCommand: string): string {
  return `${CLI_COPY.snapshotSavedUndo} ${revertCommand}`;
}

export function keptFilesHeader(count: number): string {
  return `Kept ${count} ${pluralNoun(count, "file")} ${CLI_COPY.keptFilesIntro}`;
}

export function keptReportedBeforeLine(count: number): string {
  return `${count} more kept ${pluralNoun(count, "file")} in a plugin folder ${count === 1 ? "was" : "were"} listed by an earlier apply. \`ht profile status\` lists every kept file.`;
}

export function keptLinkOutsideRoot(path: string): string {
  return `Kept ${path}: it is your link to a file outside your home, and HarnessTap never writes through it.`;
}

export function skippedRemovalOutsideRoot(path: string): string {
  return `Skipped removing ${path} (a folder above it links outside your home).`;
}

export function forceRemoveHintLine(count: number): string {
  return `To remove ${count === 1 ? "it" : "them"} too, run the command again with --force-remove.`;
}

export function restoredRemovedLine(
  restored: number,
  removed: number,
  options: { dryRun?: boolean } = {},
): string {
  if (options.dryRun) {
    return `Would restore ${restored}, would remove ${removed}.`;
  }
  return `Restored ${restored}, removed ${removed}.`;
}

export function dryRunSectionHeader(
  kind: "write" | "remove" | "keep",
  count: number,
): string {
  switch (kind) {
    case "write":
      return `Would write (${count})`;
    case "remove":
      return `Would remove (${count})`;
    case "keep":
      return `Would keep (${count})`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** Claude Code's plugin store, which it rewrites on a marketplace refresh or plugin update. */
function isClaudePluginStorePath(path: string): boolean {
  return path.replaceAll("\\", "/").startsWith(".claude/plugins/");
}

export function keptReasonLabel(reason: "modified" | "unmanaged", path?: string): string {
  switch (reason) {
    case "modified":
      return path && isClaudePluginStorePath(path) ? CLI_COPY.keptClaudeChanged : CLI_COPY.keptYouChanged;
    case "unmanaged":
      return CLI_COPY.keptNotMade;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}
