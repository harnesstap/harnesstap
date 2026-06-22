import { marketplaceIsConfigured } from "../plugins/claude-plugin-ref.js";
import { defaultRunCommand } from "../plugins/run-command.js";
import type { ClaudeLayerConfig } from "../types.js";

export interface MarketplaceRepoEntry {
  name: string;
  repo: string;
}

export function marketplaceRepoKey(repo: string): string {
  return repo.trim().replace(/\.git$/, "");
}

export function extractMarketplaceRepos(
  config: ClaudeLayerConfig | undefined,
): MarketplaceRepoEntry[] {
  if (!config?.marketplaces) {
    return [];
  }

  const entries: MarketplaceRepoEntry[] = [];
  const seen = new Set<string>();

  for (const [name, entry] of Object.entries(config.marketplaces)) {
    const source = entry.source;
    if (source.source !== "github" || !source.repo) {
      continue;
    }
    const repo = marketplaceRepoKey(source.repo);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    entries.push({ name, repo });
  }

  return entries;
}

export interface EnsureMarketplacesOptions {
  homeRoot: string;
  projectRoot: string;
  runClaudePlugin?: (args: string[]) => { exitCode: number };
}

export function ensureClaudeMarketplacesFromConfig(
  config: ClaudeLayerConfig | undefined,
  options: EnsureMarketplacesOptions,
): string[] {
  const run =
    options.runClaudePlugin ??
    ((args) => {
      const result = defaultRunCommand("claude", ["plugin", ...args], {
        cwd: options.projectRoot,
      });
      return { exitCode: result.exitCode };
    });
  const added: string[] = [];
  for (const { name, repo } of extractMarketplaceRepos(config)) {
    if (marketplaceIsConfigured(options.homeRoot, name)) continue;
    const result = run(["marketplace", "add", repo]);
    if (result.exitCode === 0) added.push(name);
  }
  return added;
}
