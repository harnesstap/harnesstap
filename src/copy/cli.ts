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
