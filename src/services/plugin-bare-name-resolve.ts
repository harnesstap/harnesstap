import { listPluginsInScope } from "./catalog-client.js";
import { isPublicCatalogEnabled } from "../config/catalog.js";
import type { CatalogPlugin } from "./catalog-types.js";
import {
  parsePluginSelector,
  resolveRemotePluginSelector,
  type ResolvedRemotePluginSelector,
} from "./plugin-selector.js";
import {
  isPluginExportFilePath,
  isPluginUrl,
} from "./plugin-source.js";
import { catalogPluginKey } from "../ui/catalog-list-render.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";

export class PluginResolveError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[] = []) {
    super(message);
    this.name = "PluginResolveError";
    this.hints = hints;
  }
}

export class PluginAmbiguityError extends PluginResolveError {
  readonly candidates: CatalogPlugin[];

  constructor(selector: string, candidates: CatalogPlugin[]) {
    const lines = candidates.map((plugin) =>
      formatCatalogSelector(plugin, plugin.latestVersion ?? undefined),
    );
    super(
      `Ambiguous plugin name: ${selector}\n${lines.map((line) => `  ${line}`).join("\n")}`,
      ["Use a fully qualified selector: org/catalog/slug@version"],
    );
    this.candidates = candidates;
  }
}

export type ResolveBareNameOptions = {
  account?: string;
  baseUrl?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: "human" | "json";
  promptAmbiguity?: (input: {
    selector: string;
    candidates: CatalogPlugin[];
  }) => Promise<CatalogPlugin>;
};

export type ResolveInstallSelectorOptions = ResolveBareNameOptions & {
  org?: string;
  catalog?: string;
  version?: string;
};

export function isBareInstallSelector(selector: string): boolean {
  if (isPluginUrl(selector) || isPluginExportFilePath(selector)) {
    return false;
  }
  return !selector.includes("/");
}

export async function resolveInstallSelector(
  selector: string,
  options: ResolveInstallSelectorOptions = {},
): Promise<ResolvedRemotePluginSelector> {
  if (isBareInstallSelector(selector)) {
    const hasRemoteHelpers = Boolean(
      options.org || options.catalog || options.version,
    );
    if (hasRemoteHelpers || !isPublicCatalogEnabled()) {
      return resolveRemotePluginSelector(selector, {
        org: options.org,
        catalog: options.catalog,
        version: options.version,
      });
    }
    return resolveBareNameFromCatalog(selector, options);
  }
  return resolveRemotePluginSelector(selector, {
    org: options.org,
    catalog: options.catalog,
    version: options.version,
  });
}

function exactCatalogMatches(plugins: CatalogPlugin[], searchName: string): CatalogPlugin[] {
  const normalized = searchName.trim().toLowerCase();
  return plugins.filter(
    (plugin) =>
      plugin.slug.toLowerCase() === normalized
      || plugin.name.toLowerCase() === normalized,
  );
}

function dedupeCatalogPluginsByIdentity(plugins: CatalogPlugin[]): CatalogPlugin[] {
  const byKey = new Map<string, CatalogPlugin>();
  for (const plugin of plugins) {
    byKey.set(catalogPluginKey(plugin), plugin);
  }
  return [...byKey.values()];
}

export function formatCatalogSelector(plugin: CatalogPlugin, version?: string): string {
  const base = `${plugin.orgSlug}/${plugin.catalogSlug}/${plugin.slug}`;
  const resolvedVersion = version ?? plugin.latestVersion ?? undefined;
  return resolvedVersion ? `${base}@${resolvedVersion}` : base;
}

function formatCatalogPluginChoiceLabel(plugin: CatalogPlugin): string {
  const selector = formatCatalogSelector(plugin, plugin.latestVersion ?? undefined);
  const summary = plugin.summary?.trim() || plugin.name;
  return `${selector} — ${summary}`;
}

export async function promptCatalogPluginAmbiguity(
  selector: string,
  candidates: CatalogPlugin[],
): Promise<CatalogPlugin> {
  const selectedKey = await promptForChoice({
    message: `Multiple catalog plugins match "${selector}". Which one?`,
    choices: candidates.map((plugin) => ({
      name: formatCatalogPluginChoiceLabel(plugin),
      value: catalogPluginKey(plugin),
    })),
  });
  const match = candidates.find((plugin) => catalogPluginKey(plugin) === selectedKey);
  if (!match) {
    throw new PluginResolveError(`Plugin not found: ${selector}`);
  }
  return match;
}

async function pickCatalogPluginMatch(
  selector: string,
  matches: CatalogPlugin[],
  options: ResolveBareNameOptions,
): Promise<CatalogPlugin> {
  const unique = dedupeCatalogPluginsByIdentity(matches);
  if (unique.length === 1) {
    const only = unique[0];
    if (!only) {
      throw new PluginResolveError(`Plugin not found: ${selector}`);
    }
    return only;
  }

  if (options.promptAmbiguity) {
    return options.promptAmbiguity({ selector, candidates: unique });
  }

  const canPrompt = shouldUseWizard({
    interactive: options.interactive ?? true,
    noInteractive: options.noInteractive,
    format: options.format ?? "human",
    missingRequiredArgs: false,
  });
  if (!canPrompt) {
    throw new PluginAmbiguityError(selector, unique);
  }

  return promptCatalogPluginAmbiguity(selector, unique);
}

export async function resolveBareNameFromCatalog(
  selector: string,
  options: ResolveBareNameOptions = {},
): Promise<ResolvedRemotePluginSelector> {
  if (!isPublicCatalogEnabled()) {
    throw new PluginResolveError(
      `Plugin not found: ${selector}`,
      [
        "Enable catalog.publicCatalog in ~/.harnesstap/config.jsonc",
        "Or use a published selector: org/catalog/slug",
      ],
    );
  }

  const parsed = parsePluginSelector(selector);
  if (parsed.scope !== "local") {
    throw new PluginResolveError(`Plugin not found: ${selector}`);
  }

  const catalogResults = await listPluginsInScope(
    { q: parsed.name, limit: 100, sort: "name" },
    { account: options.account, baseUrl: options.baseUrl },
  );
  const matches = exactCatalogMatches(catalogResults, parsed.name);

  if (matches.length === 0) {
    throw new PluginResolveError(`Plugin not found: ${selector}`, [
      "ht plugin list --search <query> --remote-only",
      "ht plugin pull org/catalog/slug",
      "ht plugin list",
    ]);
  }

  const match = await pickCatalogPluginMatch(selector, matches, options);

  return resolveRemotePluginSelector(
    formatCatalogSelector(match, parsed.version ?? match.latestVersion ?? undefined),
    {},
  );
}
