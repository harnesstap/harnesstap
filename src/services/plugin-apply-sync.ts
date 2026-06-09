import { getDb } from "../db/connection.js";
import {
  ensurePluginResource,
  findPluginResourceByPin,
} from "./composition-resource.js";
import { parseVersionConstraint } from "./plugin-constraints.js";
import { syncPluginResource } from "./resource-sync.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";
import { getInstalledPluginInstallPath } from "../plugins/claude-installed.js";
import { defaultRunCommand } from "../plugins/run-command.js";
import type { PluginResourceMetadata, Resource } from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";

export interface SyncPluginPinsForApplyOptions {
  pins: PluginConstraintPin[];
  /** When true, refresh every pinned plugin (--sync-plugins). */
  syncAll?: boolean;
  homeRoot?: string;
}

function ensureClaudePluginInstalled(ref: string, homeRoot: string): void {
  if (getInstalledPluginInstallPath(homeRoot, ref)) {
    return;
  }

  defaultRunCommand("claude", ["plugin", "install", ref, "--scope", "user"]);
}

function stampResolvedVersionFromExactConstraint(
  resource: Resource,
  constraint: string,
): Resource | null {
  try {
    const parsed = parseVersionConstraint(constraint);
    if (parsed.kind !== "exact") {
      return null;
    }

    const metadata: PluginResourceMetadata = {
      ...(resource.metadata as PluginResourceMetadata),
      resolved_version: parsed.version,
      sync_status: "synced",
    };
    const updatedAt = new Date().toISOString();
    getDb()
      .prepare("UPDATE resources SET metadata = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(metadata), updatedAt, resource.id);

    return { ...resource, metadata, updated_at: updatedAt };
  } catch {
    return null;
  }
}

export async function syncPluginPinsForApply(
  options: SyncPluginPinsForApplyOptions,
): Promise<void> {
  const homeRoot = options.homeRoot ?? resolveHomeRoot();

  for (const pin of options.pins) {
    if (!pin.version_constraint) {
      continue;
    }

    const selector = pin.ref.includes(":") ? pin.ref : `plugin:${pin.ref}`;
    const constraint =
      pin.version_constraint === "latest" || pin.version_constraint === "*"
        ? undefined
        : pin.version_constraint;

    let resource =
      findPluginResourceByPin(pin.ref, pin.version_constraint) ??
      ensurePluginResource(selector, { versionConstraint: constraint });

    const metadata = (resource.metadata ?? {}) as PluginResourceMetadata;
    const needsSync = options.syncAll || !metadata.resolved_version;
    if (!needsSync) {
      continue;
    }

    ensureClaudePluginInstalled(pin.ref, homeRoot);

    await syncPluginResource(resource, {
      policy: "overwrite",
      onConflict: "overwrite",
      homeRoot,
    });

    resource =
      findPluginResourceByPin(pin.ref, pin.version_constraint) ?? resource;
    const syncedMetadata = (resource.metadata ?? {}) as PluginResourceMetadata;
    if (!syncedMetadata.resolved_version) {
      stampResolvedVersionFromExactConstraint(resource, pin.version_constraint);
    }
  }
}
