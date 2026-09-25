import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type {
  PluginDependencyMetadata,
  Resource,
  SerializedFile,
} from "../types.js";
import type {
  InstalledPluginRecord,
  InstalledPluginsFile,
} from "../plugins/claude-installed.js";
import { parsePluginRef } from "../plugins/host-plugin-manifest.js";
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
): string {
  const marketplace = marketplaceName(resource);
  const version = versionDirName(resource);
  if (layout === "cursor") {
    if (isLocalMarketplace(marketplace)) {
      return `.cursor/plugins/local/${resource.name}`;
    }
    return `.cursor/plugins/cache/${marketplace}/${resource.name}/${version}`;
  }
  const mp = isLocalMarketplace(marketplace) ? "local" : marketplace;
  return `.claude/plugins/cache/${mp}/${resource.name}/${version}`;
}

function collectPluginTextFiles(
  root: string,
): Array<{ relativePath: string; content: string }> {
  const files: Array<{ relativePath: string; content: string }> = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".refresh")) {
        continue;
      }
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const content = readFileSync(absolute, "utf-8");
        const relativePath = relative(root, absolute).split(sep).join("/");
        files.push({ relativePath, content });
      } catch {
        // Skip unreadable or binary files; host plugin trees are text manifests.
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

function mergeEnabledPlugin(
  files: SerializedFile[],
  homeRoot: string,
  ref: string,
): void {
  const settingsPath = ".claude/settings.json";
  const existingOnDisk = existsSync(join(homeRoot, settingsPath))
    ? readFileSync(join(homeRoot, settingsPath), "utf-8")
    : undefined;
  const generated = files.find((file) => file.path === settingsPath)?.content
    ?? existingOnDisk
    ?? "{}";
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(generated) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const enabled =
    parsed.enabledPlugins &&
    typeof parsed.enabledPlugins === "object" &&
    !Array.isArray(parsed.enabledPlugins)
      ? { ...(parsed.enabledPlugins as Record<string, boolean>) }
      : {};
  enabled[ref] = true;
  const overlay = JSON.stringify({ enabledPlugins: enabled }, null, 2);
  const merged = mergeClaudeSettingsContent(
    files.find((file) => file.path === settingsPath)?.content ?? existingOnDisk,
    overlay,
  );
  upsertSerializedFile(files, settingsPath, merged);
}

export interface EmitHostPluginTreesOptions {
  layout: HostPluginLayout;
  homeRoot: string;
  files?: SerializedFile[];
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

  for (const resource of resources) {
    if (!isHostPluginPinResource(resource)) continue;
    const originRef = pluginRef(resource);
    const sourceRoot = resolveInstallRoot(originRef, options.homeRoot);
    if (!sourceRoot || !existsSync(sourceRoot)) continue;

    const relativeRoot = hostPluginRelativeRoot(options.layout, resource);
    for (const file of collectPluginTextFiles(sourceRoot)) {
      files.push({
        path: `${relativeRoot}/${file.relativePath}`,
        content: file.content,
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
