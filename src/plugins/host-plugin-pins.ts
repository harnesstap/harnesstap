import { existsSync } from "node:fs";
import type { PluginPinMetadata, ResourceCreateInput } from "../types.js";
import { parsePluginRef } from "./host-plugin-manifest.js";
import type { PluginInstall } from "./types.js";

export function hasInstallPath(
  install: PluginInstall,
): install is PluginInstall & { installPath: string } {
  if (!install.installPath) return false;
  return existsSync(install.installPath);
}

export function pluginInstallToPinInput(
  install: PluginInstall,
  source: string,
): ResourceCreateInput {
  const { name, marketplace } = parsePluginRef(install.ref);
  const metadata: PluginPinMetadata = {
    source_kind: marketplace && marketplace !== "local" ? "marketplace" : "local",
    ...(marketplace && marketplace !== "local"
      ? { marketplace_name: marketplace }
      : {}),
    ...(install.version && install.version !== "unknown"
      ? { resolved_version: install.version }
      : {}),
    sync_status: "never_synced",
    portable: "reference",
  };
  return {
    type: "plugin",
    name: install.name || name,
    namespace: marketplace,
    description:
      install.metadata?.description?.trim() || `Plugin pin: ${install.ref}`,
    content: "{}",
    metadata,
    source,
    origin_kind:
      marketplace && marketplace !== "local" ? "marketplace_link" : "manual",
    origin_ref: install.ref,
  };
}

export function preferPluginInstall(
  current: PluginInstall | undefined,
  candidate: PluginInstall,
): boolean {
  if (!current) {
    return true;
  }
  if (candidate.enabled && !current.enabled) {
    return true;
  }
  if (!candidate.enabled && current.enabled) {
    return false;
  }
  if (candidate.scope === "user" && current.scope !== "user") {
    return true;
  }
  return false;
}

export function dedupePluginInstalls(
  installs: readonly PluginInstall[],
): PluginInstall[] {
  const byRef = new Map<string, PluginInstall>();
  for (const install of installs) {
    const current = byRef.get(install.ref);
    if (preferPluginInstall(current, install)) {
      byRef.set(install.ref, install);
    }
  }
  return [...byRef.values()].sort((left, right) =>
    left.ref.localeCompare(right.ref),
  );
}
