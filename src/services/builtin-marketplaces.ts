import type { PluginMarketplacePlatform } from "../config/settings.js";

/** Cursor's built-in public marketplace, cloned from github.com/cursor/plugins. */
export const CURSOR_PUBLIC_MARKETPLACE = "cursor-public";

export const CURSOR_PUBLIC_GIT_URL = "https://github.com/cursor/plugins.git";

export const CURSOR_PUBLIC_PLATFORMS: PluginMarketplacePlatform[] = [
  "cursor",
  "claude-code",
];

export function isCursorPublicMarketplace(name: string): boolean {
  return name === CURSOR_PUBLIC_MARKETPLACE;
}

export function builtinMarketplaceGitUrl(name: string): string | null {
  return isCursorPublicMarketplace(name) ? CURSOR_PUBLIC_GIT_URL : null;
}

export function builtinMarketplaceEntry(): {
  name: string;
  url: string;
  platforms: PluginMarketplacePlatform[];
} {
  return {
    name: CURSOR_PUBLIC_MARKETPLACE,
    url: CURSOR_PUBLIC_GIT_URL,
    platforms: [...CURSOR_PUBLIC_PLATFORMS],
  };
}

/**
 * Public Claude Code marketplaces that catalog profiles name in their
 * marketplace dependencies (`<plugin>@<marketplace>`). A fresh home has none
 * of them registered, so dependency installs resolve these names to their
 * public git source instead of failing with "Marketplace not found". A
 * marketplace registered with `ht marketplace add` always wins.
 */
const WELL_KNOWN_CLAUDE_MARKETPLACES: Readonly<Record<string, string>> = {
  "claude-plugins-official": "https://github.com/anthropics/claude-plugins-official.git",
  "karpathy-skills": "https://github.com/forrestchang/andrej-karpathy-skills.git",
};

export function wellKnownMarketplaceEntry(name: string):
  | { name: string; url: string; platforms: PluginMarketplacePlatform[] }
  | undefined {
  const url = WELL_KNOWN_CLAUDE_MARKETPLACES[name];
  return url ? { name, url, platforms: ["claude-code"] } : undefined;
}
