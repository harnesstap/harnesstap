import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { marketplaceIsConfigured } from "../plugins/claude-plugin-ref.js";
import { defaultRunCommand, resolveCommandResult } from "../plugins/run-command.js";
import type { ClaudeMarketplaceSource, ClaudePluginConfig } from "../types.js";
import { wellKnownMarketplaceEntry } from "./builtin-marketplaces.js";
import { addMarketplace, findKnownMarketplace, isLocalFilesystemSource } from "./marketplace-registry.js";

export interface MarketplaceRepoEntry {
  name: string;
  repo: string;
}

export function marketplaceRepoKey(repo: string): string {
  return repo.trim().replace(/\.git$/, "");
}

export function extractMarketplaceRepos(
  config: ClaudePluginConfig | undefined,
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

export async function ensureClaudeMarketplacesFromConfig(
  config: ClaudePluginConfig | undefined,
  options: EnsureMarketplacesOptions,
): Promise<string[]> {
  const run =
    options.runClaudePlugin ??
    (async (args: string[]) => {
      const result = await resolveCommandResult(
        defaultRunCommand("claude", ["plugin", ...args], {
          cwd: options.projectRoot,
        }),
      );
      return { exitCode: result.exitCode };
    });
  const added: string[] = [];
  for (const { name, repo } of extractMarketplaceRepos(config)) {
    if (marketplaceIsConfigured(options.homeRoot, name)) continue;
    const result = await run(["marketplace", "add", repo]);
    if (result.exitCode === 0) added.push(name);
  }
  return added;
}

/** Where a Claude marketplace source lives: a git URL, or an existing local directory. */
export function marketplaceSourceGitUrl(source: ClaudeMarketplaceSource | undefined): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  if (source.source === "github" && typeof source.repo === "string" && source.repo.trim()) {
    return `https://github.com/${marketplaceRepoKey(source.repo)}.git`;
  }
  if ((source.source === "git" || source.source === "url") && typeof source.url === "string") {
    const url = source.url.trim();
    return url && !isLocalFilesystemSource(url) ? url : undefined;
  }
  // A local marketplace only means something on the machine that has it.
  if (source.source === "directory" && typeof source.path === "string") {
    const path = source.path.trim();
    return path && isAbsolute(path) && existsSync(path) ? path : undefined;
  }
  return undefined;
}

export interface DeclaredMarketplacesResult {
  added: string[];
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Register the marketplaces a profile declares in `com.harnesstap/claude.toml`
 * (`[marketplaces.<name>.source]`) with HarnessTap itself, so its
 * dependencies resolve without the `claude` binary. Only adds: a name that is
 * already registered or built in is left as it is.
 */
export function registerDeclaredMarketplaces(
  config: ClaudePluginConfig | undefined,
  harnesstapDir: string,
): DeclaredMarketplacesResult {
  const result: DeclaredMarketplacesResult = { added: [], skipped: [] };
  for (const [name, entry] of Object.entries(config?.marketplaces ?? {})) {
    if (findKnownMarketplace(harnesstapDir, name) || wellKnownMarketplaceEntry(name)) continue;
    const url = marketplaceSourceGitUrl(entry?.source);
    if (!url) {
      result.skipped.push({ name, reason: "its source is neither a git repository nor a directory on this machine" });
      continue;
    }
    try {
      const added = addMarketplace(harnesstapDir, { name, url, platforms: ["claude-code"] });
      if (added.status === "added") {
        result.added.push(name);
      } else {
        result.skipped.push({ name, reason: `${url} is already registered as ${added.entry.name}` });
      }
    } catch (error) {
      result.skipped.push({ name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
