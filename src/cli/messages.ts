/** DS-6 user-facing CLI error and hint copy. ASCII only. Always `ht` in hints. */

export function quoteName(name: string): string {
  return `"${name.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
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

export { ON_CONFLICT_HELP, ON_CONFLICT_PLUGIN_IMPORT_HELP, ON_CONFLICT_APPLY_HELP } from "./on-conflict.js";

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
  scopeAdd: (name: string, harnesses: string): string =>
    `Run ${["ht", "resource", "scope", name, "--add", harnesses].join(" ")}.`,
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
  invalidPluginName: (name: string): string =>
    `${quoteName(name)} isn't a valid plugin name. Use a non-empty name without /, \\, .. or control characters.`,
  emptyPluginName: "Pass a plugin name.",
  resourceSyncStale: (count: number): string =>
    `${count} linked resource${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} stale.`,
} as const;
