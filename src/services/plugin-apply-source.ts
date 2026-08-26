import type { Plugin } from "../types.js";
import {
  formatPublishedPluginSelector,
  getPluginByName,
  getPluginByCatalogVersion,
  getPluginByPublishedIdentity,
  listLatestPublishedPluginsBySlug,
  resolvePluginSelector,
} from "../models/plugin-model.js";
import {
  parsePluginSelector,
  resolveRemotePluginSelector,
} from "./plugin-selector.js";
import type { CatalogPlugin } from "./catalog-types.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import {
  PluginResolveError,
  resolveBareNameFromCatalog,
} from "./plugin-bare-name-resolve.js";
import { satisfiesConstraint } from "./plugin-constraints.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";
import {
  fetchPluginExportToTempFile,
  isPluginExportFilePath,
  isPluginUrl,
} from "./plugin-source.js";

export type ResolvedApplyPluginSource =
  | { kind: "local"; pluginId: string }
  | { kind: "plugin-export"; path: string };

export interface ResolveApplyPluginSourceOptions {
  account?: string;
  baseUrl?: string;
  onFetched?: (sourceLabel: string) => void;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: "human" | "json";
  promptAmbiguity?: (input: {
    selector: string;
    candidates: CatalogPlugin[];
  }) => Promise<CatalogPlugin>;
}

function resolveLocalPlugin(selector: string): Plugin | undefined {
  const direct = resolvePluginSelector(selector);
  if (direct) {
    return direct;
  }

  try {
    const parsed = parsePluginSelector(selector);
    if (parsed.scope !== "published") {
      return undefined;
    }

    if (parsed.version) {
      const byPublishedIdentity = getPluginByPublishedIdentity({
        name: parsed.name,
        version: parsed.version,
        org: parsed.org,
        catalog: parsed.catalog,
      });
      if (byPublishedIdentity) {
        return byPublishedIdentity;
      }

      return getPluginByCatalogVersion(parsed.org, parsed.catalog, parsed.version);
    }

    return getPluginByName(parsed.name);
  } catch {
    return undefined;
  }
}

function isPublishedSelector(selector: string): boolean {
  try {
    return parsePluginSelector(selector).scope === "published";
  } catch {
    return false;
  }
}

function isBarePluginName(selector: string): boolean {
  if (isPluginUrl(selector) || isPluginExportFilePath(selector)) {
    return false;
  }
  return !selector.includes("/");
}

function filterPluginsByVersionConstraint(
  plugins: Plugin[],
  versionConstraint?: string,
): Plugin[] {
  if (!versionConstraint) {
    return plugins;
  }
  return plugins.filter((plugin) => satisfiesConstraint(versionConstraint, plugin.version));
}

function getUnpublishedLocalByName(name: string): Plugin | undefined {
  const plugin = resolvePluginSelector(name);
  if (!plugin) {
    return undefined;
  }
  if (plugin.org_slug || plugin.catalog_slug) {
    return undefined;
  }
  return plugin;
}

function formatLocalPublishedAmbiguity(selector: string, plugins: Plugin[]): string {
  const lines = plugins.map((plugin) => formatPublishedPluginSelector(plugin));
  return `Ambiguous plugin name: ${selector}\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

async function promptLocalPublishedAmbiguity(
  selector: string,
  plugins: Plugin[],
): Promise<Plugin> {
  const selected = await promptForChoice({
    message: `Multiple installed plugins match "${selector}". Which one?`,
    choices: plugins.map((plugin) => ({
      name: formatPublishedPluginSelector(plugin),
      value: plugin.id,
    })),
  });
  const match = plugins.find((plugin) => plugin.id === selected);
  if (!match) {
    throw new PluginResolveError(`Plugin not found: ${selector}`);
  }
  return match;
}

async function pickLocalPublishedPlugin(
  selector: string,
  plugins: Plugin[],
  options: ResolveApplyPluginSourceOptions,
): Promise<Plugin> {
  if (plugins.length === 1) {
    const only = plugins[0];
    if (!only) {
      throw new PluginResolveError(`Plugin not found: ${selector}`);
    }
    return only;
  }

  const canPrompt = shouldUseWizard({
    interactive: options.interactive ?? true,
    noInteractive: options.noInteractive,
    format: options.format ?? "human",
    missingRequiredArgs: false,
  });

  if (!canPrompt) {
    throw new PluginResolveError(formatLocalPublishedAmbiguity(selector, plugins), [
      "Use a fully qualified selector: org/catalog/slug@version",
    ]);
  }

  return promptLocalPublishedAmbiguity(selector, plugins);
}

async function resolveBareApplyPluginSource(
  selector: string,
  options: ResolveApplyPluginSourceOptions,
): Promise<ResolvedApplyPluginSource> {
  const parsed = parsePluginSelector(selector);
  if (parsed.scope !== "local") {
    throw new PluginResolveError(`Plugin not found: ${selector}`);
  }

  const publishedLocals = filterPluginsByVersionConstraint(
    listLatestPublishedPluginsBySlug(parsed.name),
    parsed.version,
  );
  if (publishedLocals.length > 0) {
    const plugin = await pickLocalPublishedPlugin(selector, publishedLocals, options);
    return { kind: "local", pluginId: plugin.id };
  }

  const unpublishedLocal = getUnpublishedLocalByName(parsed.name);
  if (unpublishedLocal) {
    return { kind: "local", pluginId: unpublishedLocal.id };
  }

  const remote = await resolveBareNameFromCatalog(selector, {
    account: options.account,
    baseUrl: options.baseUrl,
    interactive: options.interactive,
    noInteractive: options.noInteractive,
    format: options.format,
    promptAmbiguity: options.promptAmbiguity,
  });
  const installed = await installPluginFromCatalog(remote, {
    account: options.account,
    baseUrl: options.baseUrl,
  });
  options.onFetched?.(installed.sourceLabel);
  return { kind: "local", pluginId: installed.pluginId };
}

export async function resolveApplyPluginSource(
  selector: string,
  options: ResolveApplyPluginSourceOptions = {},
): Promise<ResolvedApplyPluginSource> {
  if (isPluginUrl(selector)) {
    const path = await fetchPluginExportToTempFile(selector);
    return { kind: "plugin-export", path };
  }

  if (isPluginExportFilePath(selector)) {
    return { kind: "plugin-export", path: selector };
  }

  const localPlugin = resolveLocalPlugin(selector);
  if (localPlugin && !isBarePluginName(selector)) {
    return { kind: "local", pluginId: localPlugin.id };
  }

  if (isBarePluginName(selector)) {
    return resolveBareApplyPluginSource(selector, options);
  }

  if (!isPublishedSelector(selector)) {
    throw new PluginResolveError(`Plugin not found: ${selector}`, [
      "ht plugin list --search <query> --remote-only",
      "ht plugin pull org/catalog/name",
      "ht plugin list",
    ]);
  }

  const parsed = resolveRemotePluginSelector(selector, {});
  const installed = await installPluginFromCatalog(parsed, {
    account: options.account,
    baseUrl: options.baseUrl,
  });
  options.onFetched?.(installed.sourceLabel);
  return { kind: "local", pluginId: installed.pluginId };
}
