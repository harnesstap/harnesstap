import { getHarnesstapDir } from "../db/connection.js";
import {
  createPlugin,
  deletePlugin,
  getPluginById,
  getPluginByName,
} from "../models/plugin-model.js";
import { refreshGitSource } from "../plugins/refresh.js";
import { trackPluginInstalled } from "../telemetry/index.js";
import type { Plugin } from "../types.js";
import {
  applyCheckedPluginOrigin,
  gitOriginCacheDir,
} from "./plugin-origin-apply.js";
import {
  formatOriginLocator,
  recoverOriginLocator,
} from "./plugin-origin-locator.js";
import { getPluginOrigin, setPluginOrigin } from "./plugin-origin.js";
import { isPluginInstallRoot, scanPluginSource } from "./plugin-source-import.js";
import type { OriginRefreshResult } from "./plugin-origin-update.js";
import {
  GitPluginImportError,
  MISSING_PLUGIN_JSON_MESSAGE,
  normalizeGitHubPluginUrl,
} from "./github-plugin-ref.js";

export {
  GitPluginImportError,
  MISSING_PLUGIN_JSON_MESSAGE,
  isGitHubPluginRef,
  normalizeGitHubPluginUrl,
} from "./github-plugin-ref.js";

export type ImportPluginFromGitHubDeps = {
  refreshGit?: (options: {
    url: string;
    targetDir: string;
  }) => OriginRefreshResult | Promise<OriginRefreshResult>;
};

export interface ImportedGitHubPlugin {
  plugin: Plugin;
  origin_locator: string;
  origin_fingerprint: string;
  created: boolean;
}

function sameGitLocator(plugin: Plugin, url: string): boolean {
  const locator = recoverOriginLocator(plugin);
  if (!locator || locator.kind !== "git") {
    return false;
  }
  return formatOriginLocator(locator) === url;
}

export async function importPluginFromGitHubRef(
  input: string,
  deps?: ImportPluginFromGitHubDeps,
): Promise<ImportedGitHubPlugin> {
  let url: string;
  try {
    url = normalizeGitHubPluginUrl(input);
  } catch (error) {
    if (error instanceof GitPluginImportError) {
      throw error;
    }
    throw new GitPluginImportError(
      "invalid_ref",
      error instanceof Error ? error.message : String(error),
    );
  }

  const harnesstapDir = getHarnesstapDir();
  const targetDir = gitOriginCacheDir(harnesstapDir, url);
  const refreshGit = deps?.refreshGit ?? refreshGitSource;
  const refresh = await refreshGit({ url, targetDir });
  if (!refresh.ok || !refresh.sha) {
    throw new GitPluginImportError(
      "clone_failed",
      refresh.message || `Failed to fetch ${url}`,
    );
  }

  if (!isPluginInstallRoot(targetDir)) {
    throw new GitPluginImportError("missing_plugin_json", MISSING_PLUGIN_JSON_MESSAGE);
  }

  const scans = await scanPluginSource(targetDir);
  const scan = scans[0];
  if (!scan?.plugin_name) {
    throw new GitPluginImportError("missing_plugin_json", MISSING_PLUGIN_JSON_MESSAGE);
  }

  const existing = getPluginByName(scan.plugin_name);
  let plugin: Plugin;
  let created = false;
  if (existing) {
    if (getPluginOrigin(existing.id) !== "upstream" || !sameGitLocator(existing, url)) {
      throw new GitPluginImportError(
        "name_conflict",
        `Plugin name already exists: ${scan.plugin_name}. Use a different local name or delete the existing plugin first.`,
      );
    }
    plugin = existing;
  } else {
    plugin = createPlugin({
      name: scan.plugin_name,
      version: scan.plugin_version || refresh.sha.slice(0, 12),
      description: `Git origin ${url}`,
      origin: "upstream",
    });
    setPluginOrigin(plugin.id, "upstream");
    created = true;
  }

  try {
    await applyCheckedPluginOrigin(plugin, {
      origin_locator: url,
      origin_fingerprint: refresh.sha,
    });
    const updated = getPluginById(plugin.id) ?? plugin;
    if (created) {
      trackPluginInstalled({ pluginSlug: updated.name, source: "url" });
    }
    return {
      plugin: updated,
      origin_locator: url,
      origin_fingerprint: refresh.sha,
      created,
    };
  } catch (error) {
    if (created) {
      deletePlugin(plugin.id);
    }
    if (error instanceof GitPluginImportError) {
      throw error;
    }
    throw new GitPluginImportError(
      "clone_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
