import {
  loadSettings,
  saveSettings,
  type PluginMarketplaceEntry,
  type PluginMarketplacePlatform,
} from "../config/settings.js";

export function normalizeMarketplaceUrl(url: string): string {
  return url.trim().replace(/\.git$/i, "");
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

  const entry: PluginMarketplaceEntry = {
    name,
    url,
    platforms: [...input.platforms],
  };
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
    }
  | { status: "not_found"; name: string };

export function updateMarketplace(
  harnesstapDir: string,
  currentName: string,
  input: {
    name?: string;
    url?: string;
    platforms?: PluginMarketplacePlatform[];
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

  if (nextName !== current.name) {
    const collision = existing.find((e) => e.name === nextName);
    if (collision) {
      throw new Error(
        `Marketplace name conflict: "${nextName}" already points at ${collision.url}. Pass a different --name or remove it first.`,
      );
    }
  }

  const entry: PluginMarketplaceEntry = {
    name: nextName,
    url: nextUrl,
    platforms: nextPlatforms,
  };
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
  };
}
