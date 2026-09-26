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
