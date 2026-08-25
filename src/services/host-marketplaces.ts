import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  PluginMarketplaceEntry,
  PluginMarketplacePlatform,
} from "../config/settings.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { readJsonFile } from "../plugins/claude-installed.js";
import { readMarketplaceManifest } from "./marketplace-catalog.js";
import {
  listMarketplaces,
  normalizeMarketplaceUrl,
} from "./marketplace-registry.js";

export interface VisibleMarketplaceEntry extends PluginMarketplaceEntry {
  managed: boolean;
  contentRoot?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function githubMarketplaceUrl(repo: string): string {
  const trimmed = repo.trim();
  if (trimmed.includes("://")) {
    return stripTrailingSlash(normalizeMarketplaceUrl(trimmed));
  }
  return stripTrailingSlash(normalizeMarketplaceUrl(`https://github.com/${trimmed}`));
}

function repositoryUrlFromManifest(root: string): string | undefined {
  const raw = readMarketplaceManifest(root);
  if (!isRecord(raw)) return undefined;
  const repository = raw.repository;
  if (typeof repository === "string" && repository.trim()) {
    return stripTrailingSlash(normalizeMarketplaceUrl(repository));
  }
  if (isRecord(repository) && typeof repository.url === "string" && repository.url.trim()) {
    return stripTrailingSlash(normalizeMarketplaceUrl(repository.url));
  }
  return undefined;
}

function discoverClaudeMarketplaces(homeRoot: string): VisibleMarketplaceEntry[] {
  const knownPath = join(homeRoot, ".claude", "plugins", "known_marketplaces.json");
  const known = readJsonFile<Record<string, unknown>>(knownPath);
  if (!known || !isRecord(known)) return [];

  const discovered: VisibleMarketplaceEntry[] = [];
  for (const [name, value] of Object.entries(known)) {
    const trimmedName = name.trim();
    if (!trimmedName || !isRecord(value)) continue;

    const source = isRecord(value.source) ? value.source : {};
    const kind = typeof source.source === "string" ? source.source : "";
    const installLocation =
      typeof value.installLocation === "string" && value.installLocation.trim()
        ? value.installLocation.trim()
        : undefined;
    const contentRoot =
      installLocation && existsSync(installLocation) ? installLocation : undefined;

    let url = "";
    switch (kind) {
      case "github": {
        const repo = typeof source.repo === "string" ? source.repo : "";
        if (!repo.trim()) continue;
        url = githubMarketplaceUrl(repo);
        break;
      }
      case "directory": {
        const path =
          typeof source.path === "string" && source.path.trim()
            ? source.path.trim()
            : (installLocation ?? "");
        if (!path) continue;
        url = (contentRoot ? repositoryUrlFromManifest(contentRoot) : undefined) ?? path;
        break;
      }
      default:
        continue;
    }

    const platforms: PluginMarketplacePlatform[] = ["claude-code"];
    discovered.push({
      name: trimmedName,
      url,
      platforms,
      managed: false,
      ...(contentRoot ? { contentRoot } : {}),
    });
  }
  return discovered;
}

export function listVisibleMarketplaces(
  harnesstapDir: string,
  homeRoot: string = resolveHomeRoot(),
): VisibleMarketplaceEntry[] {
  const registered = listMarketplaces(harnesstapDir).map((entry) => ({
    ...entry,
    managed: true as const,
  }));
  const seenNames = new Set(registered.map((entry) => entry.name));
  const seenUrls = new Set(
    registered.map((entry) => stripTrailingSlash(normalizeMarketplaceUrl(entry.url))),
  );

  const host: VisibleMarketplaceEntry[] = [];
  for (const entry of discoverClaudeMarketplaces(homeRoot)) {
    const urlKey = stripTrailingSlash(normalizeMarketplaceUrl(entry.url));
    if (seenNames.has(entry.name) || seenUrls.has(urlKey)) continue;
    seenNames.add(entry.name);
    seenUrls.add(urlKey);
    host.push(entry);
  }

  return [...registered, ...host];
}

export function toMarketplaceListEntry(
  entry: VisibleMarketplaceEntry,
): PluginMarketplaceEntry & { managed: boolean } {
  return {
    name: entry.name,
    url: entry.url,
    platforms: entry.platforms,
    managed: entry.managed,
  };
}
