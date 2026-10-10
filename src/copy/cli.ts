/**
 * User-facing CLI copy. ASCII punctuation only (DS-6).
 * Command hints always start with `ht`.
 */

export const DRY_RUN_NOTHING_CHANGED = "Dry run. Nothing was changed.";

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
  dryRunHeader: DRY_RUN_NOTHING_CHANGED,
  everythingUpToDate: (unchanged: number): string => `Everything is up to date. ${unchanged} unchanged.`,
} as const;
