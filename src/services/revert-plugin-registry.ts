import type { SerializedFile } from "../types.js";
import type { SafeRemovalSkip } from "./safe-file-removal.js";

/**
 * A revert restores a plugin whole or not at all. The files a plugin is
 * registered in (`installed_plugins.json`, `known_marketplaces.json`) are
 * merged configs: when one is kept as it is because it is not HarnessTap's,
 * the plugins and marketplaces the snapshot registered there stay out too,
 * their cache files and `enabledPlugins` keys with them. Restoring them would
 * leave a plugin the host does not know and HarnessTap cannot tell from the
 * user's own.
 */
const REGISTRY_RE = /^(.*)\/plugins\/(installed_plugins|known_marketplaces)\.json$/;

export interface HeldBack {
  /** Paths (files, or folders ending in `/`) not restored. */
  prefixes: string[];
  /** `enabledPlugins` keys in the sibling settings.json not restored. */
  enabledKeys: string[];
  /** What the user is told. */
  skips: SafeRemovalSkip[];
}

function jsonKeys(content: string | undefined, field?: string): string[] {
  if (content === undefined) return [];
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const value = field ? parsed[field] : parsed;
    return typeof value === "object" && value !== null ? Object.keys(value) : [];
  } catch {
    return [];
  }
}

function listed(names: readonly string[], noun: string): string {
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `${noun}${names.length === 1 ? "" : "s"} ${shown}${more}`;
}

function pluginsInCache(files: readonly SerializedFile[], cache: string): string[] {
  const found = new Set<string>();
  for (const file of files) {
    if (!file.path.startsWith(cache)) continue;
    const [marketplace, name] = file.path.slice(cache.length).split("/");
    if (marketplace && name) found.add(`${name}@${marketplace}`);
  }
  return [...found];
}

export function heldBackByRegistry(
  files: readonly SerializedFile[],
  keptPaths: ReadonlySet<string>,
): HeldBack | undefined {
  const held: HeldBack = { prefixes: [], enabledKeys: [], skips: [] };
  const content = new Map(files.map((file) => [file.path, file.content]));
  for (const registry of keptPaths) {
    const match = REGISTRY_RE.exec(registry);
    if (!match) continue;
    const root = match[1] ?? "";
    const pluginsDir = `${root}/plugins`;
    const cache = `${pluginsDir}/cache/`;
    const installed = `${pluginsDir}/installed_plugins.json`;
    const file = registry.slice(pluginsDir.length + 1);
    const registered = jsonKeys(content.get(installed), "plugins");
    if (match[2] === "installed_plugins") {
      const names: string[] = [];
      for (const key of registered) {
        const [name, marketplace] = key.split("@");
        if (!name || !marketplace) continue;
        held.prefixes.push(`${cache}${marketplace}/${name}/`);
        held.enabledKeys.push(key);
        names.push(key);
      }
      if (names.length > 0) {
        held.skips.push({
          path: registry,
          reason: "unmanaged",
          message: `Skipped restoring ${listed(names, "plugin")} (${file} was kept as it is, so ${names.length === 1 ? "it is" : "they are"} not registered there).`,
        });
      }
    } else {
      const marketplaces = jsonKeys(content.get(registry));
      for (const marketplace of marketplaces) {
        held.prefixes.push(`${cache}${marketplace}/`, `${pluginsDir}/harnesstap-marketplaces/${marketplace}/`);
        for (const key of [...registered, ...pluginsInCache(files, cache)]) {
          if (key.endsWith(`@${marketplace}`)) held.enabledKeys.push(key);
        }
      }
      if (marketplaces.length > 0) {
        held.skips.push({
          path: registry,
          reason: "unmanaged",
          message: `Skipped restoring ${listed(marketplaces, "marketplace")} and ${marketplaces.length === 1 ? "its" : "their"} plugins (${file} was kept as it is, so ${marketplaces.length === 1 ? "it is" : "they are"} not registered there).`,
        });
      }
    }
  }
  const touched = held.prefixes.some((prefix) => files.some((file) => file.path.startsWith(prefix)));
  const keys = held.enabledKeys.length > 0;
  if (!touched && !keys) return undefined;
  held.enabledKeys = [...new Set(held.enabledKeys)];
  return held;
}

/** The settings content without the `enabledPlugins` keys of the plugins held back. */
export function withoutEnabledKeys(content: string, keys: readonly string[]): string {
  if (keys.length === 0) return content;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const enabled = parsed.enabledPlugins;
    if (typeof enabled !== "object" || enabled === null) return content;
    const next = { ...(enabled as Record<string, unknown>) };
    for (const key of keys) delete next[key];
    const indent = /^\{\n( +)"/.exec(content)?.[1]?.length ?? 2;
    const tail = content.endsWith("\n") ? "\n" : "";
    return `${JSON.stringify({ ...parsed, enabledPlugins: next }, null, indent)}${tail}`;
  } catch {
    return content;
  }
}
