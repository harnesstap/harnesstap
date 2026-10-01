import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSettings,
  parseTrackedBranches,
  saveSettings,
  type PluginMarketplaceEntry,
  type PluginMarketplacePlatform,
} from "../config/settings.js";

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, "");
}

function isLocalFilesystemSource(value: string): boolean {
  if (value.startsWith("file:")) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  if (value.startsWith("~/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

export function normalizeMarketplaceUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("file:")) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "file:") {
        return stripGitSuffix(fileURLToPath(parsed));
      }
    } catch {
      // fall through to filesystem / remote handling
    }
  }

  if (isLocalFilesystemSource(trimmed)) {
    const expanded = trimmed.startsWith("~/")
      ? resolve(homedir(), trimmed.slice(2))
      : isAbsolute(trimmed)
        ? trimmed
        : resolve(trimmed);
    return stripGitSuffix(expanded);
  }

  return stripGitSuffix(trimmed);
}

export function marketplaceEntryPayload(
  name: string,
  url: string,
  platforms: PluginMarketplacePlatform[],
  trackedBranches?: string[],
): PluginMarketplaceEntry {
  const branches = parseTrackedBranches(trackedBranches ?? []);
  return {
    name,
    url,
    platforms: [...platforms],
    ...(branches.length > 0 ? { trackedBranches: branches } : {}),
  };
}

export type AddMarketplaceResult =
  | { status: "added"; entry: PluginMarketplaceEntry }
  | { status: "already_configured"; entry: PluginMarketplaceEntry };

export function listMarketplaces(harnesstapDir: string): PluginMarketplaceEntry[] {
  return loadSettings(harnesstapDir).plugins.marketplaces;
}

export function addMarketplace(
  harnesstapDir: string,
  input: {
    url: string;
    name: string;
    platforms: PluginMarketplacePlatform[];
    trackedBranches?: string[];
  },
): AddMarketplaceResult {
  const url = normalizeMarketplaceUrl(input.url);
  const name = input.name.trim();
  if (!name) throw new Error("Marketplace name is required");
  if (!url) throw new Error("Marketplace URL is required");
  if (input.platforms.length === 0) {
    throw new Error("At least one --platform is required");
  }

  const settings = loadSettings(harnesstapDir);
  const existing = settings.plugins.marketplaces;
  const byUrl = existing.find(
    (e) => normalizeMarketplaceUrl(e.url) === url,
  );
  if (byUrl) {
    return { status: "already_configured", entry: byUrl };
  }
  const byName = existing.find((e) => e.name === name);
  if (byName) {
    throw new Error(
      `Marketplace name conflict: "${name}" already points at ${byName.url}. Pass a different --name or remove it first.`,
    );
  }

  const entry = marketplaceEntryPayload(
    name,
    url,
    input.platforms,
    input.trackedBranches,
  );
  saveSettings(harnesstapDir, {
    ...settings,
    plugins: {
      ...settings.plugins,
      marketplaces: [...existing, entry],
    },
  });
  return { status: "added", entry };
}

export type RemoveMarketplaceResult =
  | { status: "removed"; entry: PluginMarketplaceEntry }
  | { status: "not_found"; name: string };

export function removeMarketplace(
  harnesstapDir: string,
  name: string,
): RemoveMarketplaceResult {
  const settings = loadSettings(harnesstapDir);
  const entry = settings.plugins.marketplaces.find((e) => e.name === name);
  if (!entry) return { status: "not_found", name };
  saveSettings(harnesstapDir, {
    ...settings,
    plugins: {
      ...settings.plugins,
      marketplaces: settings.plugins.marketplaces.filter((e) => e.name !== name),
    },
  });
  return { status: "removed", entry };
}

export type UpdateMarketplaceResult =
  | {
      status: "updated";
      entry: PluginMarketplaceEntry;
      renamedFrom?: string;
      urlChanged: boolean;
      trackedBranchesChanged: boolean;
    }
  | { status: "not_found"; name: string };

export function updateMarketplace(
  harnesstapDir: string,
  currentName: string,
  input: {
    name?: string;
    url?: string;
    platforms?: PluginMarketplacePlatform[];
    trackedBranches?: string[];
  },
): UpdateMarketplaceResult {
  const settings = loadSettings(harnesstapDir);
  const existing = settings.plugins.marketplaces;
  const index = existing.findIndex((e) => e.name === currentName);
  if (index < 0) return { status: "not_found", name: currentName };

  const current = existing[index];
  if (!current) return { status: "not_found", name: currentName };

  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) throw new Error("Marketplace name is required");
  const nextUrl =
    input.url !== undefined ? normalizeMarketplaceUrl(input.url) : current.url;
  if (!nextUrl) throw new Error("Marketplace URL is required");
  const nextPlatforms =
    input.platforms !== undefined ? [...input.platforms] : [...current.platforms];
  if (nextPlatforms.length === 0) {
    throw new Error("At least one --platform is required");
  }
  const nextTrackedBranches =
    input.trackedBranches !== undefined
      ? parseTrackedBranches(input.trackedBranches)
      : parseTrackedBranches(current.trackedBranches ?? []);

  if (nextName !== current.name) {
    const collision = existing.find((e) => e.name === nextName);
    if (collision) {
      throw new Error(
        `Marketplace name conflict: "${nextName}" already points at ${collision.url}. Pass a different --name or remove it first.`,
      );
    }
  }

  if (nextUrl !== current.url) {
    const collision = existing.find(
      (e) => e.name !== current.name && normalizeMarketplaceUrl(e.url) === nextUrl,
    );
    if (collision) {
      throw new Error(
        `Marketplace URL conflict: "${collision.name}" already points at ${collision.url}. Pass a different --url or remove it first.`,
      );
    }
  }

  const entry = marketplaceEntryPayload(
    nextName,
    nextUrl,
    nextPlatforms,
    nextTrackedBranches,
  );
  const trackedBranchesChanged =
    parseTrackedBranches(current.trackedBranches ?? []).join("\0") !==
    parseTrackedBranches(entry.trackedBranches ?? []).join("\0");
  const marketplaces = [...existing];
  marketplaces[index] = entry;
  saveSettings(harnesstapDir, {
    ...settings,
    plugins: { ...settings.plugins, marketplaces },
  });
  return {
    status: "updated",
    entry,
    ...(nextName !== current.name ? { renamedFrom: current.name } : {}),
    urlChanged: nextUrl !== current.url,
    trackedBranchesChanged,
  };
}
