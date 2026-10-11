import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import { listCursorPluginInstalls } from "../plugins/cursor-inventory.js";
import {
  CURSOR_LOCAL_PLUGIN_SIDECAR,
  CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT,
  cursorLocalPluginFolderName,
  cursorLocalPluginSidecarContent,
  sanitizeCursorLocalFolderSegment,
} from "../plugins/cursor-local-plugin.js";
import { getPlatform } from "../platforms/registry.js";
import type {
  PluginDependencyMetadata,
  Resource,
  SerializedFile,
  SurfaceWarning,
} from "../types.js";
import type {
  InstalledPluginRecord,
  InstalledPluginsFile,
} from "../plugins/claude-installed.js";
import { parsePluginRef } from "../plugins/host-plugin-manifest.js";
import { filterHostPluginRuntimeFiles } from "./host-plugin-runtime-modules.js";
import { resolveInstallRoot } from "./resource-sync.js";
import { mergeClaudeSettingsContent } from "./merged-host-config.js";

const SKIP_DIR_NAMES = new Set([".git", "node_modules", ".refresh-staging"]);

export type HostPluginLayout = "claude-code" | "cursor";

export function isHostPluginPinResource(
  resource: Pick<Resource, "type" | "metadata" | "origin_ref">,
): boolean {
  if (resource.type !== "plugin") return false;
  const metadata = (resource.metadata ?? {}) as PluginDependencyMetadata;
  if (metadata.source_kind === "catalog") return false;
  const origin = resource.origin_ref ?? "";
  return (
    metadata.source_kind === "marketplace" ||
    metadata.source_kind === "local" ||
    origin.includes("@")
  );
}

function pluginRef(resource: Resource): string {
  if (resource.origin_ref?.includes("@")) {
    return resource.origin_ref;
  }
  const metadata = (resource.metadata ?? {}) as PluginDependencyMetadata;
  const marketplace = metadata.marketplace_name ?? "";
  return marketplace ? `${resource.name}@${marketplace}` : resource.name;
}

function marketplaceName(resource: Resource): string {
  const metadata = (resource.metadata ?? {}) as PluginDependencyMetadata;
  if (metadata.marketplace_name) return metadata.marketplace_name;
  return parsePluginRef(pluginRef(resource)).marketplace || "local";
}

function versionDirName(resource: Resource): string {
  const metadata = (resource.metadata ?? {}) as PluginDependencyMetadata;
  const version = metadata.resolved_version?.trim() || "unknown";
  return version.replace(/[\\/]/g, "-");
}

function isLocalMarketplace(marketplace: string): boolean {
  return marketplace === "" || marketplace === "local";
}

/** Relative install root under home (posix), without a trailing slash. */
export function hostPluginRelativeRoot(
  layout: HostPluginLayout,
  resource: Resource,
  cursorFolder?: string,
): string {
  const marketplace = marketplaceName(resource);
  const version = versionDirName(resource);
  if (layout === "cursor") {
    const folder = cursorFolder ?? sanitizeCursorLocalFolderSegment(resource.name);
    return `${CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT}/${folder}`;
  }
  const mp = isLocalMarketplace(marketplace) ? "local" : marketplace;
  return `.claude/plugins/cache/${mp}/${resource.name}/${version}`;
}

/** Folder names for one Cursor emit. Duplicate plugin names keep the marketplace. */
export function assignCursorLocalPluginFolders(
  resources: readonly Resource[],
): Map<string, string> {
  const pins = resources.filter(isHostPluginPinResource);
  const nameCounts = new Map<string, number>();
  for (const resource of pins) {
    nameCounts.set(resource.name, (nameCounts.get(resource.name) ?? 0) + 1);
  }
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  for (const resource of pins) {
    const duplicate = (nameCounts.get(resource.name) ?? 0) > 1;
    let folder = cursorLocalPluginFolderName(
      resource.name,
      marketplaceName(resource),
      duplicate,
    );
    if (used.has(folder)) {
      folder = `${folder}--${sanitizeCursorLocalFolderSegment(pluginRef(resource))}`;
    }
    used.add(folder);
    assigned.set(pluginRef(resource), folder);
  }
  return assigned;
}

function collectPluginFiles(
  root: string,
): Array<{ relativePath: string; content: string; encoding?: "utf8" | "base64" }> {
  const files: Array<{ relativePath: string; content: string; encoding?: "utf8" | "base64" }> = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".refresh")) {
        continue;
      }
      if (entry.name === CURSOR_LOCAL_PLUGIN_SIDECAR) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const bytes = readFileSync(absolute);
        const relativePath = relative(root, absolute).split(sep).join("/");
        if (bytes.includes(0)) {
          files.push({
            relativePath,
            content: bytes.toString("base64"),
            encoding: "base64",
          });
          continue;
        }
        files.push({ relativePath, content: bytes.toString("utf8") });
      } catch {
        // Skip unreadable files.
      }
    }
  }
  return files;
}

function upsertSerializedFile(
  files: SerializedFile[],
  path: string,
  content: string,
): void {
  const index = files.findIndex((file) => file.path === path);
  if (index >= 0) {
    files[index] = { path, content };
    return;
  }
  files.push({ path, content });
}

function mergeInstalledPluginsContent(
  existingRaw: string | undefined,
  ref: string,
  record: InstalledPluginRecord,
): string {
  let file: InstalledPluginsFile = { version: 2, plugins: {} };
  if (existingRaw) {
    try {
      const fromString = JSON.parse(existingRaw) as InstalledPluginsFile;
      file = {
        version: fromString.version ?? 2,
        plugins: { ...(fromString.plugins ?? {}) },
      };
    } catch {
      file = { version: 2, plugins: {} };
    }
  }

  const current = file.plugins[ref] ?? [];
  const rest = current.filter((row) => row.scope !== record.scope);
  file.plugins[ref] = [record, ...rest];
  return `${JSON.stringify(file, null, 2)}\n`;
}

function enabledPluginsFromRaw(raw: string | undefined): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { enabledPlugins?: unknown };
    if (
      parsed.enabledPlugins &&
      typeof parsed.enabledPlugins === "object" &&
      !Array.isArray(parsed.enabledPlugins)
    ) {
      return { ...(parsed.enabledPlugins as Record<string, boolean>) };
    }
  } catch {
    return {};
  }
  return {};
}

function mergeEnabledPlugin(
  files: SerializedFile[],
  homeRoot: string,
  ref: string,
): void {
  const settingsPath = ".claude/settings.json";
  const existingOnDisk = existsSync(join(homeRoot, settingsPath))
    ? readFileSync(join(homeRoot, settingsPath), "utf-8")
    : undefined;
  const generated = files.find((file) => file.path === settingsPath)?.content;
  const enabled = {
    ...enabledPluginsFromRaw(existingOnDisk),
    ...enabledPluginsFromRaw(generated),
    [ref]: true,
  };
  const overlay = JSON.stringify({ enabledPlugins: enabled }, null, 2);
  const merged = mergeClaudeSettingsContent(
    generated ?? existingOnDisk,
    overlay,
  );
  upsertSerializedFile(files, settingsPath, merged);
}

function shadowedCursorMarketplaceNames(homeRoot: string): Set<string> {
  const names = new Set<string>();
  for (const install of listCursorPluginInstalls(homeRoot)) {
    if (install.scope === "local" || !install.enabled) continue;
    names.add(install.name);
  }
  return names;
}

export interface EmitHostPluginTreesOptions {
  layout: HostPluginLayout;
  homeRoot: string;
  files?: SerializedFile[];
  surfaceWarnings?: SurfaceWarning[];
}

/**
 * Copy host plugin install trees into the target harness native plugin root.
 * Claude and Cursor do not load each other's install directories at runtime,
 * so sync dual-writes native trees. Manifests stay as found (Agent Plugins
 * root `plugin.json`, `.claude-plugin/`, `.cursor-plugin/`).
 */
export function emitHostPluginTrees(
  resources: readonly Resource[],
  options: EmitHostPluginTreesOptions,
): SerializedFile[] {
  const files = options.files ? [...options.files] : [];
  const installedPath = ".claude/plugins/installed_plugins.json";
  const cursorFolders = options.layout === "cursor"
    ? assignCursorLocalPluginFolders(resources)
    : null;
  const shadowedNames = options.layout === "cursor"
    ? shadowedCursorMarketplaceNames(options.homeRoot)
    : null;

  for (const resource of resources) {
    if (!isHostPluginPinResource(resource)) continue;
    const originRef = pluginRef(resource);
    if (shadowedNames?.has(resource.name)) {
      options.surfaceWarnings?.push({
        harness: "cursor",
        path: `${CURSOR_LOCAL_PLUGINS_RELATIVE_ROOT}/${resource.name}`,
        category: "cursor-local-plugin",
        message: `Cursor already runs ${resource.name} from a marketplace install, which takes precedence over ~/.cursor/plugins/local. Left that install in place.`,
        alias_harnesses: [],
      });
      continue;
    }
    const sourceRoot = resolveInstallRoot(originRef, options.homeRoot, undefined, {
      preferCanonicalPackage: false,
    });
    if (!sourceRoot || !existsSync(sourceRoot)) continue;

    const relativeRoot = hostPluginRelativeRoot(
      options.layout,
      resource,
      cursorFolders?.get(originRef),
    );
    const collected = collectPluginFiles(sourceRoot);
    const allowRuntimeModules =
      getPlatform(options.layout)?.hostPluginRuntimeModules === true;
    const filtered = filterHostPluginRuntimeFiles(collected, allowRuntimeModules);
    for (const file of filtered.files) {
      files.push({
        path: `${relativeRoot}/${file.relativePath}`,
        content: file.content,
        ...(file.encoding === "base64" ? { encoding: "base64" as const } : {}),
      });
    }
    if (options.layout === "cursor") {
      files.push({
        path: `${relativeRoot}/${CURSOR_LOCAL_PLUGIN_SIDECAR}`,
        content: cursorLocalPluginSidecarContent(originRef),
      });
    }
    if (filtered.skippedModules.length > 0) {
      options.surfaceWarnings?.push({
        harness: "claude-code",
        path: filtered.skippedModules[0] ?? "hooks/",
        category: "claude-mod",
        message:
          "Claude Code mods (in-process hooks.json + JS/TS) are not emitted to hosts without hostPluginRuntimeModules.",
        alias_harnesses: [options.layout],
      });
    }

    if (options.layout === "claude-code") {
      const metadata = (resource.metadata ?? {}) as PluginDependencyMetadata;
      const record: InstalledPluginRecord = {
        scope: "user",
        installPath: relativeRoot.replace(/^\.claude\/plugins\//, ""),
        version: metadata.resolved_version ?? "unknown",
      };
      const existing = files.find((file) => file.path === installedPath)?.content
        ?? (existsSync(join(options.homeRoot, installedPath))
          ? readFileSync(join(options.homeRoot, installedPath), "utf-8")
          : undefined);
      upsertSerializedFile(
        files,
        installedPath,
        mergeInstalledPluginsContent(existing, originRef, record),
      );
      mergeEnabledPlugin(files, options.homeRoot, originRef);
    }
  }

  return files;
}
