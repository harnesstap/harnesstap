import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { harnesstapDirForHomeRoot } from "../db/connection.js";
import { hostPluginPackageDir } from "./package-cache/paths.js";
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
import {
  getInstalledPluginRecord,
  type InstalledPluginRecord,
  type InstalledPluginsFile,
  resolveInstalledRecordPath,
} from "../plugins/claude-installed.js";
import {
  type ClaudeMarketplacePlugin,
  emitClaudeMarketplaceRegistrations,
  remoteMarketplaceUrl,
} from "./claude-marketplace-registration.js";
import { parsePluginRef } from "../plugins/host-plugin-manifest.js";
import { readHostPluginViewRecord } from "./package-cache/host-plugin-views.js";
import { isHarnessTapClaudeRecord } from "./claude-plugin-record-owner.js";
import { filterHostPluginRuntimeFiles } from "./host-plugin-runtime-modules.js";
import { resolveInstallRoot } from "./resource-sync.js";
import { translateEmittedSpecTree } from "./host-plugin-spec-emit.js";
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

/** The `name@marketplace` ref a host plugin pin installs as. */
export function hostPluginPinRef(
  resource: Pick<Resource, "name" | "metadata" | "origin_ref">,
): string {
  return pluginRef(resource);
}

function pluginRef(resource: Pick<Resource, "name" | "metadata" | "origin_ref">): string {
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

/**
 * The files the apply writes into a host plugin folder for a plugin package:
 * the package tree with spec plugins translated for the host (for example
 * `mcp.json` written as Claude's `.mcp.json`).
 */
export function emittedHostPluginTree(
  packageDir: string,
  layout: HostPluginLayout,
  pluginName: string,
): Map<string, { content: string; encoding?: "utf8" | "base64" }> {
  const filtered = filterHostPluginRuntimeFiles(
    collectPluginFiles(packageDir),
    getPlatform(layout)?.hostPluginRuntimeModules === true,
  );
  const translated = translateEmittedSpecTree(filtered.files, { layout, pluginName });
  return new Map(translated.files.map((file) => [
    file.relativePath,
    { content: file.content, ...(file.encoding ? { encoding: file.encoding } : {}) },
  ]));
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
  const prior = current.find((row) => row.scope === record.scope);
  const rest = current.filter((row) => row.scope !== record.scope);
  // Keep fields Claude Code adds to its records (install dates, commit).
  file.plugins[ref] = [prior ? { ...prior, ...record } : record, ...rest];
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

/**
 * When the install root is a host plugin folder HarnessTap created, emit only
 * the files it recorded writing. Files the user added there stay theirs: emitting
 * them would let the apply record them as HarnessTap's.
 */
function onlyHarnessTapWrittenFiles<T extends { relativePath: string }>(
  sourceRoot: string,
  collected: T[],
): T[] {
  const record = readHostPluginViewRecord(sourceRoot);
  if (!record?.created || record.legacy) return collected;
  return collected.filter((file) => file.relativePath in record.files);
}

/**
 * The tree to copy for a plugin pin. It is the installed copy, unless that copy
 * is another version than the one the pin resolved to (after `ht plugin update`
 * bumped it): then it is the package cache copy of the resolved version, so the
 * files written under that version's folder are that version's.
 */
function hostPluginSourceRoot(
  resource: Resource,
  originRef: string,
  homeRoot: string,
): string | undefined {
  const installed = resolveInstallRoot(originRef, homeRoot, undefined, {
    preferCanonicalPackage: false,
  });
  const metadata = (resource.metadata ?? {}) as PluginDependencyMetadata;
  const version = metadata.resolved_version?.trim();
  const { name, marketplace } = parsePluginRef(originRef);
  if (
    !version
    || !marketplace
    || isLocalMarketplace(marketplace)
    || (installed && basename(installed) === version)
  ) {
    return installed;
  }
  const cached = hostPluginPackageDir(
    harnesstapDirForHomeRoot(homeRoot),
    marketplace,
    name,
    version,
  );
  return existsSync(cached) ? cached : installed;
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

  const claudeMarketplaces = new Map<string, ClaudeMarketplacePlugin[]>();

  for (const resource of resources) {
    if (!isHostPluginPinResource(resource)) continue;
    const originRef = pluginRef(resource);
    const remoteMarketplace = options.layout === "claude-code"
      && remoteMarketplaceUrl(options.homeRoot, marketplaceName(resource))
      ? marketplaceName(resource)
      : undefined;
    if (remoteMarketplace) {
      const foreign = foreignClaudeInstall(
        options.homeRoot,
        originRef,
        hostPluginRelativeRoot("claude-code", resource),
      );
      if (foreign) {
        options.surfaceWarnings?.push({
          harness: "claude-code",
          path: foreign,
          category: "claude-plugin-install",
          message: `Claude Code already has ${originRef} installed at ${foreign}, outside HarnessTap. Left that install in place.`,
          alias_harnesses: [],
        });
        continue;
      }
    }
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
    const sourceRoot = hostPluginSourceRoot(resource, originRef, options.homeRoot);
    if (!sourceRoot || !existsSync(sourceRoot)) continue;

    const relativeRoot = hostPluginRelativeRoot(
      options.layout,
      resource,
      cursorFolders?.get(originRef),
    );
    const collected = onlyHarnessTapWrittenFiles(sourceRoot, collectPluginFiles(sourceRoot));
    const allowRuntimeModules =
      getPlatform(options.layout)?.hostPluginRuntimeModules === true;
    const filtered = filterHostPluginRuntimeFiles(collected, allowRuntimeModules);
    const translated = translateEmittedSpecTree(filtered.files, {
      layout: options.layout,
      pluginName: resource.name,
    });
    for (const message of translated.warnings) {
      options.surfaceWarnings?.push({
        harness: options.layout,
        path: relativeRoot,
        category: "plugin-var",
        message,
        alias_harnesses: [],
      });
    }
    const sourceContent = remoteMarketplace && isMirroredHostPluginView(join(options.homeRoot, relativeRoot))
      ? new Map(filtered.files.map((file) => [file.relativePath, file.content]))
      : undefined;
    for (const file of translated.files) {
      if (
        sourceContent
        && !isClaudeReadPluginFile(file.relativePath, file.encoding)
        && sourceContent.get(file.relativePath) === file.content
      ) {
        continue;
      }
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
      // Claude Code resolves a relative installPath against its working
      // directory, so the plugin would only load when started from home.
      const record: InstalledPluginRecord = {
        scope: "user",
        installPath: join(options.homeRoot, relativeRoot),
        version: metadata.resolved_version ?? "unknown",
      };
      if (remoteMarketplace) {
        const plugins = claudeMarketplaces.get(remoteMarketplace) ?? [];
        plugins.push({ name: resource.name, version: record.version, relativeRoot });
        claudeMarketplaces.set(remoteMarketplace, plugins);
      }
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

  emitClaudeMarketplaceRegistrations(
    files,
    options.homeRoot,
    claudeMarketplaces,
    options.surfaceWarnings,
  );
  return files;
}

/**
 * Files in a Claude Code plugin that Claude reads as configuration or as
 * model instructions: manifests, MCP and hook config, skills, commands and
 * agents. HarnessTap checks and tracks these when it writes them.
 */
const CLAUDE_READ_PLUGIN_FILE =
  /^(?:\.claude-plugin\/[^/]+|\.mcp\.json|\.lsp\.json|settings\.json|hooks\/hooks\.json|(?:skills|commands|agents|output-styles)\/.+\.(?:md|mdc|markdown|json|ya?ml|txt))$/i;

function isClaudeReadPluginFile(relativePath: string, encoding?: "utf8" | "base64"): boolean {
  return encoding !== "base64" && CLAUDE_READ_PLUGIN_FILE.test(relativePath);
}

/**
 * The folder is a copy of the package HarnessTap created and recorded
 * file by file. The record keeps and removes the rest of its files with the
 * files the apply writes, so the apply needs to write only the files Claude
 * Code reads as config or instructions, and any file it translates. Writing
 * every file would hold the whole package (often 100+ MB of assets and
 * bundles) in memory several times over and in each apply snapshot.
 */
function isMirroredHostPluginView(folder: string): boolean {
  const record = readHostPluginViewRecord(folder);
  return record?.created === true && !record.legacy && Object.keys(record.files).length > 0;
}

/**
 * Where Claude Code has `originRef` installed outside HarnessTap, if it does:
 * a plugin record HarnessTap did not write (the user installed the plugin
 * with Claude Code, even into a folder HarnessTap created), or a folder at
 * the install root HarnessTap did not create. HarnessTap neither copies over
 * nor registers such an install.
 */
function foreignClaudeInstall(
  homeRoot: string,
  originRef: string,
  relativeRoot: string,
): string | undefined {
  const candidates: string[] = [];
  const record = getInstalledPluginRecord(homeRoot, originRef);
  if (record) {
    const recordPath = resolveInstalledRecordPath(homeRoot, record);
    if (!isHarnessTapClaudeRecord(homeRoot, record)) return recordPath;
    candidates.push(recordPath);
  }
  const destination = join(homeRoot, relativeRoot);
  if (existsSync(destination)) candidates.push(destination);
  for (const path of candidates) {
    const view = readHostPluginViewRecord(path);
    if (!view?.created) return path;
  }
  return undefined;
}
