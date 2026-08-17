import type { PluginProvider } from "./types.js";
import { ClaudeCodePluginProvider } from "./providers/claude-code.js";
import { CopilotPluginProvider } from "./providers/copilot-cli.js";
import { CursorPluginProvider } from "./providers/cursor.js";
import { DeepSeekHarnessPluginProvider } from "./providers/deepseek-harness.js";
import { GoosePluginProvider } from "./providers/goose.js";

const providers = new Map<string, PluginProvider>([
  ["claude-code", new ClaudeCodePluginProvider()],
  ["cursor", new CursorPluginProvider()],
  ["goose", new GoosePluginProvider()],
  ["copilot-cli", new CopilotPluginProvider()],
  ["deepseek-harness", new DeepSeekHarnessPluginProvider()],
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
