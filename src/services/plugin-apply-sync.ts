import {
  ensurePluginResource,
  findPluginResourceByPin,
} from "./composition-resource.js";
import { syncPluginResource } from "./resource-sync.js";
import type { PluginConstraintPin } from "./plugin-apply-validation.js";
import type { PluginResourceMetadata } from "../types.js";

export interface SyncPluginPinsForApplyOptions {
  pins: PluginConstraintPin[];
  /** When true, refresh every pinned plugin (--sync-plugins). */
  syncAll?: boolean;
  homeRoot?: string;
}

export async function syncPluginPinsForApply(
  options: SyncPluginPinsForApplyOptions,
): Promise<void> {
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

    await syncPluginResource(resource, {
      policy: "overwrite",
      onConflict: "overwrite",
      homeRoot: options.homeRoot,
    });
  }
}
