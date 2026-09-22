import { existsSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { listResources } from "../models/resource.js";
import { getPlatform } from "../platforms/registry.js";
import {
  MATERIAL_RESOURCE_TYPES,
  type PlatformPaths,
  type Resource,
} from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import {
  getHarnessSettings,
  type HarnessCatalogEntry,
  type HarnessSettingsGlobal,
} from "./harness-settings.js";
import {
  buildSharedGlobalPathSet,
  detectHomePlatforms,
  resolveConfiguredPath,
} from "./scanner.js";

/** Primary `PlatformPaths` keys. `settings` and `plugins` are containers, not features. */
export const REGISTRY_PATH_KEYS = [
  "instructions",
  "skills",
  "rules",
  "mcp",
  "permissions",
  "hooks",
  "agents",
  "commands",
  "settings",
  "plugins",
] as const satisfies readonly (keyof PlatformPaths)[];

export type RegistryPathKey = (typeof REGISTRY_PATH_KEYS)[number];

export type HarnessDiskPresence = "detected" | "shared-only" | "absent";

export interface HarnessLocationResource {
  id: string;
  type: string;
  name: string;
  description: string;
  source: string;
}

export interface HarnessLocationEntry {
  /** Registry string verbatim, e.g. `~/.claude/settings.json`. */
  path: string;
  surfaces: RegistryPathKey[];
  on_disk: boolean;
  resources: HarnessLocationResource[];
}

export interface HarnessInventoryEntry extends HarnessCatalogEntry {
  disk: HarnessDiskPresence;
  /** Empty unless the harness is configured or has files on disk. */
  locations: HarnessLocationEntry[];
}

export interface HarnessInventoryPayload {
  global: HarnessSettingsGlobal;
  root: string;
  harnesses: HarnessInventoryEntry[];
}

/** One deduped primary path with the keys that resolve to it. */
export interface PlatformLocation {
  path: string;
  surfaces: RegistryPathKey[];
  /** `legacy_*` and `pathAlternates` for the same keys. Match-only, never a panel. */
  alternates: string[];
}

const LEGACY_KEYS: Record<"legacy_instructions" | "legacy_rules", RegistryPathKey> = {
  legacy_instructions: "instructions",
  legacy_rules: "rules",
};

function isRegistryPathKey(key: string): key is RegistryPathKey {
  return (REGISTRY_PATH_KEYS as readonly string[]).includes(key);
}

function isLegacyKey(key: string): key is keyof typeof LEGACY_KEYS {
  return Object.hasOwn(LEGACY_KEYS, key);
}

export function locationsForPlatform(paths: PlatformPaths): PlatformLocation[] {
  const locations: PlatformLocation[] = [];
  const bySurface = new Map<RegistryPathKey, PlatformLocation>();

  for (const [key, value] of Object.entries(paths)) {
    if (!isRegistryPathKey(key) || typeof value !== "string" || !value) {
      continue;
    }
    let location = locations.find((entry) => entry.path === value);
    if (!location) {
      location = { path: value, surfaces: [], alternates: [] };
      locations.push(location);
    }
    location.surfaces.push(key);
    bySurface.set(key, location);
  }

  const primaryPaths = new Set(locations.map((entry) => entry.path));
  const addAlternate = (surface: RegistryPathKey, alternate: string): void => {
    const location = bySurface.get(surface);
    if (
      !location
      || primaryPaths.has(alternate)
      || location.alternates.includes(alternate)
    ) {
      return;
    }
    location.alternates.push(alternate);
  };

  for (const [key, value] of Object.entries(paths)) {
    if (isLegacyKey(key) && typeof value === "string" && value) {
      addAlternate(LEGACY_KEYS[key], value);
    }
  }
  for (const [key, alternates] of Object.entries(paths.pathAlternates ?? {})) {
    if (!isRegistryPathKey(key) || !alternates) continue;
    for (const alternate of alternates) {
      addAlternate(key, alternate);
    }
  }

  return locations;
}

function homeRelativeSegments(
  source: string,
  homeRoot: string,
): string[] | null {
  let rel: string;
  if (source.startsWith("~/")) {
    rel = source.slice(2);
  } else if (isAbsolute(source)) {
    const fromHome = relative(homeRoot, source);
    if (!fromHome || isAbsolute(fromHome)) {
      return null;
    }
    rel = fromHome.split(sep).join("/");
  } else {
    return null;
  }
  const segments = rel.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) {
    return null;
  }
  return segments;
}

function configuredSegments(configuredPath: string): string[] {
  const stripped = configuredPath.startsWith("~/")
    ? configuredPath.slice(2)
    : configuredPath;
  return stripped.split("/").filter((segment) => segment.length > 0);
}

/**
 * Length of the configured path that matched `source`, or -1. Directory paths
 * (trailing `/`) match on prefix; file paths match exactly.
 */
function matchLength(
  sourceSegments: readonly string[],
  configuredPath: string,
): number {
  const target = configuredSegments(configuredPath);
  if (target.length === 0 || target.some((segment) => segment === "..")) {
    return -1;
  }
  const isDirectory = configuredPath.endsWith("/");
  if (isDirectory) {
    if (sourceSegments.length < target.length) return -1;
  } else if (sourceSegments.length !== target.length) {
    return -1;
  }
  for (let index = 0; index < target.length; index += 1) {
    if (sourceSegments[index] !== target[index]) return -1;
  }
  return target.length;
}

function locationMatchLength(
  sourceSegments: readonly string[],
  location: Pick<PlatformLocation, "path" | "alternates">,
): number {
  let best = -1;
  for (const candidate of [location.path, ...location.alternates]) {
    best = Math.max(best, matchLength(sourceSegments, candidate));
  }
  return best;
}

export function sourceWithinLocation(
  source: string,
  location: Pick<PlatformLocation, "path" | "alternates">,
  homeRoot: string,
): boolean {
  const segments = homeRelativeSegments(source, homeRoot);
  if (!segments) return false;
  return locationMatchLength(segments, location) >= 0;
}

/** The single most specific location `source` falls under, or null. */
export function locationForSource<T extends Pick<PlatformLocation, "path" | "alternates">>(
  source: string,
  locations: readonly T[],
  homeRoot: string,
): T | null {
  const segments = homeRelativeSegments(source, homeRoot);
  if (!segments) return null;
  let best: T | null = null;
  let bestLength = -1;
  for (const location of locations) {
    const length = locationMatchLength(segments, location);
    if (length > bestLength) {
      best = location;
      bestLength = length;
    }
  }
  return best;
}

export function classifyDiskPresence(input: {
  detected: boolean;
  existingPaths: readonly string[];
  sharedGlobalPaths: ReadonlySet<string>;
}): HarnessDiskPresence {
  if (input.detected) return "detected";
  if (
    input.existingPaths.length > 0
    && input.existingPaths.every((path) => input.sharedGlobalPaths.has(path))
  ) {
    return "shared-only";
  }
  return "absent";
}

function toLocationResource(resource: Resource): HarnessLocationResource {
  return {
    id: resource.id,
    type: resource.type,
    name: resource.name,
    description: resource.description,
    source: resource.source,
  };
}

function byName(a: HarnessLocationResource, b: HarnessLocationResource): number {
  return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
}

export function getHarnessInventory(
  homeRoot = resolveHomeRoot(),
): HarnessInventoryPayload {
  const settings = getHarnessSettings();
  const configured = new Set(
    [settings.global.main_harness, ...settings.global.alias_harnesses].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );
  const detected = new Set(
    detectHomePlatforms(homeRoot).map((entry) => entry.platformId),
  );
  const sharedGlobalPaths = buildSharedGlobalPathSet();
  const materialTypes = new Set<string>(MATERIAL_RESOURCE_TYPES);
  const homeRows = listResources().filter(
    (resource) =>
      resource.origin_ref === homeRoot && materialTypes.has(resource.type),
  );

  const harnesses = settings.harnesses.map((entry): HarnessInventoryEntry => {
    const platform = getPlatform(entry.id);
    const grouped = platform ? locationsForPlatform(platform.globalPaths) : [];
    const existing = grouped.map((location) => ({
      location,
      existingPaths: [location.path, ...location.alternates].filter((path) =>
        existsSync(resolveConfiguredPath(homeRoot, path)),
      ),
    }));
    const disk = classifyDiskPresence({
      detected: detected.has(entry.id),
      existingPaths: existing.flatMap((item) => item.existingPaths),
      sharedGlobalPaths,
    });
    if (!configured.has(entry.id) && disk === "absent") {
      return { ...entry, disk, locations: [] };
    }

    const resourcesByPath = new Map<string, HarnessLocationResource[]>();
    for (const resource of homeRows) {
      const target = locationForSource(resource.source, grouped, homeRoot);
      if (!target) continue;
      const rows = resourcesByPath.get(target.path) ?? [];
      rows.push(toLocationResource(resource));
      resourcesByPath.set(target.path, rows);
    }

    return {
      ...entry,
      disk,
      locations: existing.map(({ location, existingPaths }) => ({
        path: location.path,
        surfaces: location.surfaces,
        on_disk: existingPaths.length > 0,
        resources: (resourcesByPath.get(location.path) ?? []).sort(byName),
      })),
    };
  });

  return { global: settings.global, root: homeRoot, harnesses };
}
