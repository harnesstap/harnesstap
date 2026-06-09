import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  claudePluginsDir,
  loadInstalled,
  parsePluginRef,
  readJsonFile,
} from "./claude-installed.js";

interface MarketplaceManifest {
  name?: string;
  plugins?: Array<{ name: string }>;
}

export interface CatalogPluginInstallHint {
  /** Preferred `claude plugin install` refs, highest priority first. */
  installRefs?: readonly string[];
  /** Marketplaces to register with `claude plugin marketplace add` when missing. */
  marketplaces?: ReadonlyArray<{ name: string; repo: string }>;
}

/**
 * ClaudePluginHub "author" slugs are not Claude marketplace names.
 * Map them to configured marketplace folder names (`marketplace.json` `name`).
 */
export const CATALOG_AUTHOR_MARKETPLACES: Record<string, readonly string[]> = {
  anthropics: ["claude-plugins-official"],
  obra: ["claude-plugins-official", "superpowers-dev"],
  "multica-ai": ["karpathy-skills"],
};

/** Known catalog plugin ids → install hints (overrides author-only mapping). */
export const CATALOG_PLUGIN_INSTALL_HINTS: Record<string, CatalogPluginInstallHint> = {
  superpowers: {
    installRefs: ["superpowers@claude-plugins-official", "superpowers@superpowers-dev"],
  },
  context7: {
    installRefs: ["context7@claude-plugins-official"],
  },
  "security-guidance": {
    installRefs: ["security-guidance@claude-plugins-official"],
  },
  "andrej-karpathy-skills": {
    installRefs: ["andrej-karpathy-skills@karpathy-skills"],
    marketplaces: [
      { name: "karpathy-skills", repo: "forrestchang/andrej-karpathy-skills" },
    ],
  },
};

const DEFAULT_MARKETPLACES = ["claude-plugins-official"] as const;

function marketplaceManifestPath(homeRoot: string, marketplace: string): string {
  return join(
    claudePluginsDir(homeRoot),
    "marketplaces",
    marketplace,
    ".claude-plugin",
    "marketplace.json",
  );
}

export function marketplaceIsConfigured(homeRoot: string, marketplace: string): boolean {
  return existsSync(marketplaceManifestPath(homeRoot, marketplace));
}

export function marketplaceHasPlugin(
  homeRoot: string,
  marketplace: string,
  pluginName: string,
): boolean {
  const manifest = readJsonFile<MarketplaceManifest>(
    marketplaceManifestPath(homeRoot, marketplace),
  );
  return manifest?.plugins?.some((entry) => entry.name === pluginName) ?? false;
}

export function listConfiguredMarketplaceNames(homeRoot: string): string[] {
  const root = join(claudePluginsDir(homeRoot), "marketplaces");
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function addCandidate(ordered: string[], seen: Set<string>, candidate: string): void {
  if (seen.has(candidate)) {
    return;
  }
  seen.add(candidate);
  ordered.push(candidate);
}

/** Candidate install refs for a catalog or native plugin pin, best match first. */
export function resolveClaudeInstallRefCandidates(
  ref: string,
  homeRoot: string,
): string[] {
  const { name, marketplace } = parsePluginRef(ref);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const hint = CATALOG_PLUGIN_INSTALL_HINTS[name];
  for (const candidate of hint?.installRefs ?? []) {
    addCandidate(ordered, seen, candidate);
  }

  addCandidate(ordered, seen, ref);

  if (marketplace) {
    for (const alias of CATALOG_AUTHOR_MARKETPLACES[marketplace] ?? DEFAULT_MARKETPLACES) {
      addCandidate(ordered, seen, `${name}@${alias}`);
    }
  }

  for (const localMarketplace of listConfiguredMarketplaceNames(homeRoot)) {
    if (marketplaceHasPlugin(homeRoot, localMarketplace, name)) {
      addCandidate(ordered, seen, `${name}@${localMarketplace}`);
    }
  }

  return ordered;
}

export function resolveCatalogPluginMarketplaceBootstrap(
  ref: string,
): CatalogPluginInstallHint["marketplaces"] {
  const { name } = parsePluginRef(ref);
  return CATALOG_PLUGIN_INSTALL_HINTS[name]?.marketplaces ?? [];
}

/** Pick the enabledPlugins id: prefer an installed candidate, else the first install ref. */
export function resolveClaudeEnabledPluginRef(ref: string, homeRoot: string): string {
  const candidates = resolveClaudeInstallRefCandidates(ref, homeRoot);
  const installed = loadInstalled(homeRoot);
  for (const candidate of candidates) {
    if (installed.some((row) => row.ref === candidate)) {
      return candidate;
    }
  }
  return candidates[0] ?? ref;
}

export function findInstalledRefForCatalogPin(
  ref: string,
  homeRoot: string,
  scope?: string,
): string | undefined {
  const candidates = resolveClaudeInstallRefCandidates(ref, homeRoot);
  const installed = loadInstalled(homeRoot);
  for (const candidate of candidates) {
    const match = installed.find(
      (row) =>
        row.ref === candidate && (scope === undefined || row.scope === scope),
    );
    if (match) {
      return candidate;
    }
  }
  return undefined;
}
