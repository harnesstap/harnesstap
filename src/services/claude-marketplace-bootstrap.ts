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
