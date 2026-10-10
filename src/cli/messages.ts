/** DS-1 / DS-6 user-facing CLI copy. ASCII only. Always `ht` in hints. */

export function quoteName(name: string): string {
  return `"${name.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function hintToken(value: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]+$/.test(value)) {
    return value;
  }
  return quoteName(value);
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

export {
  ON_CONFLICT_HELP,
  ON_CONFLICT_PLUGIN_IMPORT_HELP,
  ON_CONFLICT_APPLY_HELP,
  ON_CONFLICT_VALUE_HELP,
} from "./on-conflict.js";

export const CLI_HINTS = {
  seeOptions: (commandPath: string): string =>
    commandPath.trim().length > 0
      ? `Run ht ${commandPath.trim()} --help to see the options.`
      : "Run ht --help to see the options.",
  pluginList: "Run ht plugin list to see your plugins.",
  resourceList: "Run ht resource list to see your resources.",
  profileUseExample: 'For example: ht profile use "global default"',
  authLogin: "Run ht auth login to sign in.",
  githubLogin: "Check the URL, or sign in with ht github login if it's private.",
  onConflictReplace: "Use --on-conflict replace to replace it.",
  unsavedChanges: "Run again with --changes save, stash or discard.",
  updateNpm: "Update with: npm i -g harnesstap",
  mcpSearch: (name: string): string => `Run ht mcp search ${hintToken(name)} to find it.`,
  scopeAdd: (name: string, harnesses: string): string =>
    `Run ht resource scope ${hintToken(name)} --add ${hintToken(harnesses)}.`,
  portableMcpTip: (name: string, harnessList: string, command: string): string =>
    `Tip: ${quoteName(name)} also works on ${harnessList}. Run ${command}.`,
  forceRemove: "To remove them too, run: ht apply --force-remove",
  revert: "Snapshot saved. Undo with: ht revert",
  stashPop: "Bring them back with: ht profile stash pop",
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
  unsavedChanges: (name: string, count: number): string =>
    `${quoteName(name)} has ${count} unsaved change${count === 1 ? "" : "s"}.`,
  resourceSyncStale: (count: number): string =>
    `${count} linked resource${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} stale.`,
} as const;

/** DS-1 CLI preview / scope lines. */
export const SCOPE_COPY = {
  allHarnesses: "Applies to all your harnesses",
  notSetUp: "Not set up for any harness yet",
  mainHarnessTooltip: "Your main harness. It wins when harnesses disagree.",
} as const;

export const PREVIEW_LABELS = {
  willWrite: "Will write",
  upToDate: "Up to date",
  notInProfile: "Not in profile",
  willRemove: "Will remove",
  keptChanged: "Kept. You changed it.",
  keptUnmanaged: "Kept. Not made by HarnessTap.",
  dryRunHeader: "Dry run. Nothing was changed.",
  everythingUpToDate: (unchanged: number): string => `Everything is up to date. ${unchanged} unchanged.`,
} as const;
