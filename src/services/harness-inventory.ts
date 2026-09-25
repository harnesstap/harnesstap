import { existsSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { listResources } from "../models/resource.js";
import { getAllPlatforms, getPlatform } from "../platforms/registry.js";
import type {
  PlatformDefinition,
  PlatformPaths,
  RelatedPlatformLocation,
  Resource,
} from "../types.js";
import { resolveHomeRoot } from "../utils/home-root.js";
import { inventorySourceForMatching } from "./claude-local-mcp.js";
import { scanCursorHostManagedSkills } from "./cursor-host-managed-skills.js";
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

export type LocationRelation = "native" | "shared" | "host-managed" | "related";

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
  /** How this path relates to the harness. Native paths omit extra labels. */
  relation: LocationRelation;
  /** Display name of the owning harness when `relation` is `related`. */
  related_from?: string;
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

export interface InventoryPlatformLocation extends PlatformLocation {
  relation: LocationRelation;
  relatedFrom?: string;
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

function nativePathOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const platform of getAllPlatforms()) {
    for (const location of locationsForPlatform(platform.globalPaths)) {
      const list = owners.get(location.path) ?? [];
      list.push(platform.id);
      owners.set(location.path, list);
    }
  }
  return owners;
}

function classifyRelatedPath(
  path: string,
  platformId: string,
  owners: Map<string, string[]>,
): { relation: LocationRelation; relatedFrom?: string } {
  if (path.startsWith("~/.agents/")) {
    return { relation: "shared" };
  }
  const others = (owners.get(path) ?? []).filter((id) => id !== platformId);
  if (others.length === 1) {
    const ownerId = others[0];
    const owner = ownerId ? getPlatform(ownerId) : undefined;
    return {
      relation: "related",
      relatedFrom: owner?.name ?? ownerId,
    };
  }
  if (others.length > 1) {
    return { relation: "shared" };
  }
  return { relation: "related" };
}

function visitConfiguredPaths(
  paths: PlatformPaths,
  visit: (key: RegistryPathKey, value: string) => void,
): void {
  for (const [key, value] of Object.entries(paths)) {
    if (!isRegistryPathKey(key) || typeof value !== "string" || !value) continue;
    visit(key, value);
  }
  for (const [key, alternates] of Object.entries(paths.pathAlternates ?? {})) {
    if (!isRegistryPathKey(key) || !alternates) continue;
    for (const alternate of alternates) {
      visit(key, alternate);
    }
  }
}

function hostManagedPlatformPaths(
  platform: PlatformDefinition,
): PlatformPaths | null {
  const skills = platform.hostManagedPaths?.skills;
  if (!skills) return null;
  return { skills };
}

function relatedLocationSurfaces(
  location: RelatedPlatformLocation,
): RegistryPathKey[] {
  return location.surfaces.filter((surface): surface is RegistryPathKey =>
    isRegistryPathKey(surface),
  );
}

/**
 * Native global paths, then host-managed, shared `~/.agents/` hubs inferred
 * from project paths, then explicit related locations. Detection still uses
 * native `globalPaths` only.
 */
export function inventoryLocationsForPlatform(
  platform: PlatformDefinition,
  owners = nativePathOwners(),
): InventoryPlatformLocation[] {
  const locations: InventoryPlatformLocation[] = locationsForPlatform(
    platform.globalPaths,
  ).map((location) => ({ ...location, relation: "native" }));
  const seen = new Set(locations.map((location) => location.path));

  const push = (
    path: string,
    surfaces: RegistryPathKey[],
    relation: LocationRelation,
    relatedFrom?: string,
    alternates: string[] = [],
  ): void => {
    if (!path || seen.has(path) || surfaces.length === 0) return;
    seen.add(path);
    locations.push({
      path,
      surfaces,
      alternates,
      relation,
      ...(relatedFrom ? { relatedFrom } : {}),
    });
  };

  const hostPaths = hostManagedPlatformPaths(platform);
  if (hostPaths) {
    for (const location of locationsForPlatform(hostPaths)) {
      push(
        location.path,
        location.surfaces,
        "host-managed",
        undefined,
        location.alternates,
      );
    }
  }

  visitConfiguredPaths(platform.projectPaths, (key, value) => {
    if (!value.startsWith(".agents/")) return;
    const hub = `~/${value}`;
    const classified = classifyRelatedPath(hub, platform.id, owners);
    push(hub, [key], classified.relation, classified.relatedFrom);
  });

  for (const related of platform.relatedLocations ?? []) {
    const classified = classifyRelatedPath(related.path, platform.id, owners);
    push(
      related.path,
      relatedLocationSurfaces(related),
      classified.relation,
      classified.relatedFrom,
    );
  }

  return locations;
}

function homeRelativeSegments(
  source: string,
  homeRoot: string,
): string[] | null {
  let rel: string;
  const matchSource = inventorySourceForMatching(source);
  if (matchSource.startsWith("~/")) {
    rel = matchSource.slice(2);
  } else if (isAbsolute(matchSource)) {
    const fromHome = relative(homeRoot, matchSource);
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

function isHomeInventoryRow(resource: Resource, homeRoot: string): boolean {
  if (homeRelativeSegments(resource.source, homeRoot) === null) {
    return false;
  }
  const origin = resource.origin_ref ?? "";
  if (!origin || origin === homeRoot || !isAbsolute(origin)) {
    return true;
  }
  const fromHome = relative(homeRoot, origin);
  if (!fromHome || isAbsolute(fromHome) || fromHome.split(sep).includes("..")) {
    return false;
  }
  return true;
}

function byName(a: HarnessLocationResource, b: HarnessLocationResource): number {
  return a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
}

function existingConfiguredPaths(
  location: Pick<PlatformLocation, "path" | "alternates">,
  homeRoot: string,
): string[] {
  return [location.path, ...location.alternates].filter((path) =>
    existsSync(resolveConfiguredPath(homeRoot, path)),
  );
}

function toLocationEntry(
  location: InventoryPlatformLocation,
  existingPaths: readonly string[],
  resources: readonly HarnessLocationResource[],
): HarnessLocationEntry {
  return {
    path: location.path,
    surfaces: location.surfaces,
    on_disk: existingPaths.length > 0,
    relation: location.relation,
    ...(location.relatedFrom ? { related_from: location.relatedFrom } : {}),
    resources: [...resources].sort(byName),
  };
}

function hostManagedSkillRows(
  platform: PlatformDefinition,
  location: InventoryPlatformLocation,
  homeRoot: string,
): HarnessLocationResource[] {
  if (location.relation !== "host-managed" || platform.id !== "cursor") {
    return [];
  }
  if (!location.surfaces.includes("skills")) return [];
  return scanCursorHostManagedSkills(homeRoot).map((skill) => ({
    id: "",
    type: "skill",
    name: skill.name,
    description: skill.description,
    source: skill.source,
  }));
}

function mergeLocationResources(
  libraryRows: readonly HarnessLocationResource[],
  extraRows: readonly HarnessLocationResource[],
): HarnessLocationResource[] {
  const seen = new Set(libraryRows.map((row) => `${row.type}:${row.name}:${row.source}`));
  const merged = [...libraryRows];
  for (const row of extraRows) {
    const key = `${row.type}:${row.name}:${row.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
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
  const owners = nativePathOwners();
  const homeRows = listResources().filter((resource) =>
    isHomeInventoryRow(resource, homeRoot),
  );

  const harnesses = settings.harnesses.map((entry): HarnessInventoryEntry => {
    const platform = getPlatform(entry.id);
    const nativeGrouped = platform ? locationsForPlatform(platform.globalPaths) : [];
    const nativeExisting = nativeGrouped.flatMap((location) =>
      existingConfiguredPaths(location, homeRoot),
    );
    const disk = classifyDiskPresence({
      detected: detected.has(entry.id),
      existingPaths: nativeExisting,
      sharedGlobalPaths,
    });
    if (!configured.has(entry.id) && disk === "absent") {
      return { ...entry, disk, locations: [] };
    }

    const grouped = platform
      ? inventoryLocationsForPlatform(platform, owners)
      : [];
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
      locations: grouped.map((location) => {
        const libraryRows = resourcesByPath.get(location.path) ?? [];
        const extras = platform
          ? hostManagedSkillRows(platform, location, homeRoot)
          : [];
        return toLocationEntry(
          location,
          existingConfiguredPaths(location, homeRoot),
          mergeLocationResources(libraryRows, extras),
        );
      }),
    };
  });

  return { global: settings.global, root: homeRoot, harnesses };
}
