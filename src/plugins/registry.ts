import type { PluginProvider } from "./types.js";
import { ClaudeCodePluginProvider } from "./providers/claude-code.js";
import { CursorPluginProvider } from "./providers/cursor.js";
import { GoosePluginProvider } from "./providers/goose.js";

const providers = new Map<string, PluginProvider>([
  ["claude-code", new ClaudeCodePluginProvider()],
  ["cursor", new CursorPluginProvider()],
  ["goose", new GoosePluginProvider()],
]);

export function getPluginProvider(platformId: string): PluginProvider | undefined {
  return providers.get(platformId);
}

export function getPluginProviders(platformIds?: string[]): PluginProvider[] {
  const ids = platformIds ?? [...providers.keys()];
  return ids
    .map((id) => getPluginProvider(id))
    .filter((p): p is PluginProvider => p !== undefined);
}

export function getRegisteredPluginPlatformIds(): string[] {
  return [...providers.keys()];
}
