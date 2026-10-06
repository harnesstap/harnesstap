import { writeFiles } from "../services/applier.js";
import { emitHostPluginTrees } from "../services/host-plugin-serialize.js";
import { resolveInstallRoot } from "../services/resource-sync.js";
import type { Resource } from "../types.js";
import { parsePluginRef } from "./host-plugin-manifest.js";
import { listCursorPluginInstalls } from "./cursor-inventory.js";
import type { PluginContext, PluginInstallOptions, PluginInstallResult } from "./types.js";

function pinResource(ref: string): Resource {
  const parsed = parsePluginRef(ref);
  const marketplace = parsed.marketplace || "local";
  return {
    id: "",
    type: "plugin",
    name: parsed.name,
    description: "",
    content: "{}",
    metadata: {
      source_kind: marketplace === "local" ? "local" : "marketplace",
      ...(marketplace === "local" ? {} : { marketplace_name: marketplace }),
    },
    source: "",
    namespace: marketplace,
    origin_kind: marketplace === "local" ? "manual" : "marketplace_link",
    origin_ref: ref,
    content_hash: "",
    content_blob_ref: "",
    created_at: "",
    updated_at: "",
  };
}

function marketplaceShadows(homeRoot: string, name: string): boolean {
  return listCursorPluginInstalls(homeRoot).some(
    (install) => install.scope !== "local" && install.enabled && install.name === name,
  );
}

/**
 * Copy an on-disk plugin tree into `~/.cursor/plugins/local`. Cursor loads that
 * directory on reload. Marketplace installs of the same name are left alone.
 */
export function installCursorLocalPlugin(
  ctx: PluginContext,
  opts: PluginInstallOptions,
): PluginInstallResult {
  const ref = opts.ref;
  const scope = opts.scope ?? "user";
  const parsed = parsePluginRef(ref);
  if (marketplaceShadows(ctx.homeRoot, parsed.name)) {
    return {
      ref,
      platformId: "cursor",
      scope,
      status: "already_installed",
      message: `Cursor already runs ${parsed.name} from a marketplace install, which takes precedence over ~/.cursor/plugins/local. Left that install in place.`,
    };
  }

  const source = resolveInstallRoot(ref, ctx.homeRoot, undefined, {
    preferCanonicalPackage: false,
  });
  if (!source) {
    return {
      ref,
      platformId: "cursor",
      scope,
      status: "failed",
      message: `No on-disk plugin tree for ${ref}. Sync or install it on a host that has the tree, then copy it into ~/.cursor/plugins/local.`,
    };
  }

  const files = emitHostPluginTrees([pinResource(ref)], {
    layout: "cursor",
    homeRoot: ctx.homeRoot,
  });
  if (!files.some((file) => file.path.startsWith(".cursor/plugins/local/"))) {
    return {
      ref,
      platformId: "cursor",
      scope,
      status: "failed",
      message: `Could not copy ${ref} into ~/.cursor/plugins/local.`,
    };
  }

  writeFiles(files, ctx.homeRoot);
  return {
    ref,
    platformId: "cursor",
    scope,
    status: "installed",
    message: `Copied ${ref} into ~/.cursor/plugins/local. Reload Cursor to load it.`,
  };
}
