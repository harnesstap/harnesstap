import { readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { isEmptyBuiltinProfile, isProfilePlugin } from "../constants/profile.js";
import { listPlugins, resolvePluginSelector } from "../models/plugin-model.js";
import type { Plugin } from "../types.js";
import { recordedPluginInstallRoot } from "./agent-plugins/install-root.js";
import {
  PluginResolveError,
  resolveInstallSelector,
} from "./plugin-bare-name-resolve.js";
import { installPluginFromCatalog } from "./plugin-catalog-install.js";
import {
  formatCanonicalPublishedSelectorWithVersion,
  parsePluginSelector,
  type ParsedPluginSelector,
  type ResolvedRemotePluginSelector,
} from "./plugin-selector.js";

/** A profile `ht profile use` cannot find locally and did not pull. */
export class ProfileUseTargetError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[] = []) {
    super(message);
    this.name = "ProfileUseTargetError";
    this.hints = hints;
  }
}

export interface ProfileUseTarget {
  /** Exact selector for the local profile plugin (its id). */
  selector: string;
  /** Local plugin name, recorded as the active profile. */
  name: string;
  /** Set when the profile was pulled from the catalog first. */
  pulled?: { plugin_name: string; source: string };
}

export interface ResolveProfileUseTargetOptions {
  /** `--no-pull`: never contact the catalog. */
  pull?: boolean;
  /** `--dry-run`: report a missing profile instead of pulling it. */
  dryRun?: boolean;
  account?: string;
  baseUrl?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: "human" | "json";
}

function parseSelectorOrUndefined(selector: string): ParsedPluginSelector | undefined {
  try {
    return parsePluginSelector(selector);
  } catch {
    return undefined;
  }
}

/** The package display name (`sourceName`) of a pulled Agent Plugins package. */
function installedSourceName(plugin: Plugin): string | undefined {
  const root = recordedPluginInstallRoot(plugin.name, plugin.version);
  if (!root) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")) as {
      extensions?: Record<string, { sourceName?: unknown } | undefined>;
    };
    const sourceName = manifest.extensions?.["com.harnesstap"]?.sourceName;
    return typeof sourceName === "string" && sourceName.trim() ? sourceName.trim() : undefined;
  } catch {
    return undefined;
  }
}

function catalogSlugOf(plugin: Plugin): string | undefined {
  const segments = plugin.origin_locator?.split("/") ?? [];
  return segments.length === 3 ? segments[2] : undefined;
}

function matchesPublishedRef(
  plugin: Plugin,
  ref: { org: string; catalog: string; name: string },
): boolean {
  const locator = `${ref.org}/${ref.catalog}/${ref.name}`;
  if (plugin.origin_locator === locator) return true;
  return plugin.org_slug === ref.org
    && plugin.catalog_slug === ref.catalog
    && plugin.name === ref.name;
}

function matchesBareName(plugin: Plugin, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (catalogSlugOf(plugin)?.toLowerCase() === wanted) return true;
  if (plugin.name.toLowerCase() === wanted) return true;
  return installedSourceName(plugin)?.toLowerCase() === wanted;
}

function compareNewestFirst(left: Plugin, right: Plugin): number {
  const a = semver.valid(left.version);
  const b = semver.valid(right.version);
  if (a && b) return semver.rcompare(a, b);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function describeLocal(plugin: Plugin): string {
  return plugin.origin_locator
    ? `${plugin.origin_locator}@${plugin.version}`
    : `${plugin.name}@${plugin.version}`;
}

/**
 * A local plugin `ht profile use` should apply for this selector: an exact
 * name or id, a catalog ref (`org/catalog/slug[@version]`), a catalog slug,
 * or the package display name. Profiles win over plain plugins.
 */
export function findLocalProfileForUse(selector: string): Plugin | undefined {
  const exact = resolvePluginSelector(selector);
  if (exact) return exact;

  const parsed = parseSelectorOrUndefined(selector);
  if (!parsed) return undefined;

  const all = listPlugins();
  const candidates = parsed.scope === "published"
    ? all.filter((plugin) => matchesPublishedRef(plugin, parsed))
    : all.filter((plugin) => matchesBareName(plugin, parsed.name));
  const versioned = parsed.version
    ? candidates.filter((plugin) => plugin.version === parsed.version)
    : candidates;
  if (versioned.length === 0) return undefined;

  const profiles = versioned.filter((plugin) => isProfilePlugin(plugin));
  const pool = (profiles.length > 0 ? profiles : versioned).sort(compareNewestFirst);
  const names = new Set(pool.map((plugin) => plugin.name));
  if (names.size > 1) {
    throw new ProfileUseTargetError(
      `Ambiguous profile name: ${selector}\n${pool.map((plugin) => `  ${describeLocal(plugin)}`).join("\n")}`,
      ["Use the full catalog ref: ht profile use org/catalog/slug@version"],
    );
  }
  return pool[0];
}

function pullCommand(selector: string): string {
  return /\s/.test(selector)
    ? `ht profile pull "${selector}"`
    : `ht profile pull ${selector}`;
}

/**
 * Resolve the profile `ht profile use <selector>` applies, pulling it from
 * the catalog when it is not installed locally.
 */
export async function resolveProfileUseTarget(
  selector: string,
  options: ResolveProfileUseTargetOptions = {},
): Promise<ProfileUseTarget> {
  if (isEmptyBuiltinProfile(selector)) {
    return { selector, name: selector };
  }
  const local = findLocalProfileForUse(selector);
  if (local) {
    return { selector: local.id, name: local.name };
  }

  if (options.pull === false || options.dryRun) {
    throw new ProfileUseTargetError(
      `Profile ${selector} is not installed locally.`,
      [`Pull it first: ${pullCommand(selector)}`],
    );
  }

  let remote: ResolvedRemotePluginSelector;
  try {
    remote = await resolveInstallSelector(selector, {
      account: options.account,
      baseUrl: options.baseUrl,
      interactive: options.interactive,
      noInteractive: options.noInteractive,
      format: options.format,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const hints = error instanceof PluginResolveError && error.hints.length > 0
      ? error.hints
      : [`Pull it first: ${pullCommand(selector)}`];
    throw new ProfileUseTargetError(
      `Profile ${selector} is not installed locally, and the catalog lookup failed: ${reason}`,
      hints,
    );
  }

  const ref = formatCanonicalPublishedSelectorWithVersion({
    org: remote.org_slug,
    catalog: remote.catalog_slug,
    name: remote.plugin_slug,
    version: remote.version,
  });
  try {
    const installed = await installPluginFromCatalog(remote, {
      profile: true,
      account: options.account,
      baseUrl: options.baseUrl,
    });
    return {
      selector: installed.pluginId,
      name: installed.pluginName,
      pulled: { plugin_name: installed.pluginName, source: installed.sourceLabel },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ProfileUseTargetError(
      `Profile ${selector} is not installed locally, and pulling ${ref} failed: ${reason}`,
      [`Pull it first: ${pullCommand(ref)}`],
    );
  }
}
