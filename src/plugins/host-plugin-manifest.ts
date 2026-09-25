import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Host and Agent Plugins 1.0 manifest locations, preferred native first. */
export const HOST_PLUGIN_MANIFEST_RELATIVE_PATHS = [
  ".claude-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".github/plugin/plugin.json",
  ".goose-plugin/plugin.json",
  "plugin.json",
] as const;

export interface HostPluginManifest {
  name?: string;
  version?: string;
  description?: string;
  repository?: string;
  homepage?: string;
  $schema?: string;
}

export function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function readFirstHostPluginManifest(
  installPath: string,
): HostPluginManifest | null {
  for (const relativePath of HOST_PLUGIN_MANIFEST_RELATIVE_PATHS) {
    const manifest = readJsonFile<HostPluginManifest>(
      join(installPath, relativePath),
    );
    if (manifest?.name) {
      return manifest;
    }
  }
  return null;
}

export function isAgentPluginsRootManifest(
  manifest: HostPluginManifest,
): boolean {
  return (
    typeof manifest.$schema === "string" &&
    manifest.$schema.includes("agent-plugins")
  );
}

export function parsePluginRef(ref: string): { name: string; marketplace: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref, marketplace: "" };
  return { name: ref.slice(0, at), marketplace: ref.slice(at + 1) };
}
