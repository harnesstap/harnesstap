import { getPlatform } from "../platforms/registry.js";
import type { PlatformPaths, Resource, SerializerTarget } from "../types.js";

export type HarnessScope =
  | { readonly kind: "all" }
  | { readonly kind: "subset"; readonly harnesses: readonly string[] };

export const HARNESS_SCOPE_ALL: HarnessScope = { kind: "all" };

export const LINKED_SHARED_FOLDER_TOOLTIP =
  "These read the same folder, so they share one setting";

const ALL_SENTINEL = "all";

export function parseHarnessScope(raw: unknown): HarnessScope {
  if (raw === undefined || raw === null || raw === "" || raw === ALL_SENTINEL) {
    return HARNESS_SCOPE_ALL;
  }
  if (Array.isArray(raw)) {
    const harnesses = uniqueSorted(
      raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    );
    return harnesses.length === 0
      ? HARNESS_SCOPE_ALL
      : { kind: "subset", harnesses };
  }
  if (typeof raw === "string") {
    if (raw === ALL_SENTINEL || raw === "[]") {
      return HARNESS_SCOPE_ALL;
    }
    try {
      return parseHarnessScope(JSON.parse(raw) as unknown);
    } catch {
      return HARNESS_SCOPE_ALL;
    }
  }
  return HARNESS_SCOPE_ALL;
}

export function serializeHarnessScope(scope: HarnessScope): string {
  if (scope.kind === "all") {
    return ALL_SENTINEL;
  }
  return JSON.stringify(uniqueSorted(scope.harnesses));
}

export function harnessScopeWire(scope: HarnessScope): "all" | string[] {
  return scope.kind === "all" ? "all" : [...scope.harnesses];
}

export function resourceHarnessScope(resource: Pick<Resource, "harness_scope">): HarnessScope {
  return resource.harness_scope ?? HARNESS_SCOPE_ALL;
}

export function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export function intersectHarnessScopes(
  left: HarnessScope,
  right: HarnessScope,
): HarnessScope {
  if (left.kind === "all") return right;
  if (right.kind === "all") return left;
  const rightSet = new Set(right.harnesses);
  const harnesses = left.harnesses.filter((id) => rightSet.has(id));
  return harnesses.length === 0
    ? { kind: "subset", harnesses: [] }
    : { kind: "subset", harnesses: uniqueSorted(harnesses) };
}

export function unionHarnessScopes(
  left: HarnessScope,
  right: HarnessScope,
): HarnessScope {
  if (left.kind === "all" || right.kind === "all") {
    return HARNESS_SCOPE_ALL;
  }
  return {
    kind: "subset",
    harnesses: uniqueSorted([...left.harnesses, ...right.harnesses]),
  };
}

export function resourceAppliesToHarness(
  resource: Pick<Resource, "harness_scope">,
  harnessId: string,
): boolean {
  const scope = resourceHarnessScope(resource);
  return scope.kind === "all" || scope.harnesses.includes(harnessId);
}

export function normalizeScopeToRegistered(
  scope: HarnessScope,
  registered: readonly string[],
): HarnessScope {
  if (scope.kind === "all") {
    return HARNESS_SCOPE_ALL;
  }
  const allowed = new Set(registered);
  const harnesses = uniqueSorted(scope.harnesses.filter((id) => allowed.has(id)));
  if (harnesses.length === 0) {
    return { kind: "subset", harnesses: [...scope.harnesses] };
  }
  if (coversRegistered(harnesses, registered)) {
    return HARNESS_SCOPE_ALL;
  }
  return { kind: "subset", harnesses };
}

export function coversRegistered(
  selected: readonly string[],
  registered: readonly string[],
): boolean {
  if (registered.length === 0) {
    return false;
  }
  const set = new Set(selected);
  return registered.every((id) => set.has(id));
}

export function isOrphanedHarnessScope(
  scope: HarnessScope,
  registered: readonly string[],
): boolean {
  if (scope.kind === "all") {
    return false;
  }
  if (registered.length === 0) {
    return scope.harnesses.length > 0;
  }
  const allowed = new Set(registered);
  return scope.harnesses.every((id) => !allowed.has(id));
}

export type PlatformPathSurface = keyof Omit<PlatformPaths, "pathAlternates">;

const RESOURCE_TYPE_PATH_SURFACE: Record<string, PlatformPathSurface | undefined> = {
  instruction: "instructions",
  skill: "skills",
  rule: "rules",
  mcp_server: "mcp",
  permission: "permissions",
  hook: "hooks",
  agent: "agents",
  command: "commands",
  env_var: "settings",
  model_config: "settings",
  plugin: "plugins",
  plugin_pin: "plugins",
};

export function pathSurfaceForResourceType(type: string): PlatformPathSurface | undefined {
  return RESOURCE_TYPE_PATH_SURFACE[type];
}

export function normalizeEmitPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return undefined;
  return normalized;
}

export function emitPathForResourceType(
  platformId: string,
  type: string,
  target: SerializerTarget,
): string | undefined {
  const platform = getPlatform(platformId);
  if (!platform) return undefined;
  const surface = pathSurfaceForResourceType(type);
  if (!surface) return undefined;
  const paths = target === "global" ? platform.globalPaths : platform.projectPaths;
  const primary = normalizeEmitPath(paths[surface]);
  if (primary) return primary;
  if (surface === "permissions" || surface === "hooks" || surface === "mcp") {
    return normalizeEmitPath(paths.settings);
  }
  if (surface === "settings") {
    return normalizeEmitPath(paths.settings ?? paths.permissions);
  }
  return undefined;
}

export interface LinkedHarnessGroup {
  readonly key: string;
  readonly harnessIds: readonly string[];
  readonly linked: boolean;
  readonly emitPath?: string;
}

/**
 * Group registered harnesses that write the same native folder/file for this
 * resource type and apply target. Unlinked harnesses are singleton groups.
 */
export function linkedHarnessGroups(
  registered: readonly string[],
  type: string,
  target: SerializerTarget,
): LinkedHarnessGroup[] {
  const buckets = new Map<string, string[]>();
  const unpathed: string[] = [];
  for (const id of registered) {
    const path = emitPathForResourceType(id, type, target);
    if (!path) {
      unpathed.push(id);
      continue;
    }
    const bucket = buckets.get(path) ?? [];
    bucket.push(id);
    buckets.set(path, bucket);
  }

  const groups: LinkedHarnessGroup[] = [];
  for (const [emitPath, harnessIds] of [...buckets.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    groups.push({
      key: emitPath,
      harnessIds,
      linked: harnessIds.length > 1,
      emitPath,
    });
  }
  for (const id of unpathed) {
    groups.push({ key: id, harnessIds: [id], linked: false });
  }
  return groups;
}

export function expandLinkedSelection(
  selected: readonly string[],
  toggleIds: readonly string[],
  nextChecked: boolean,
): string[] {
  const set = new Set(selected);
  for (const id of toggleIds) {
    if (nextChecked) {
      set.add(id);
    } else {
      set.delete(id);
    }
  }
  return uniqueSorted([...set]);
}

export function selectionFromGroups(
  selected: ReadonlySet<string>,
  group: LinkedHarnessGroup,
): boolean {
  return group.harnessIds.every((id) => selected.has(id));
}

export function withHarnessScope(
  resource: Resource,
  scope: HarnessScope,
): Resource {
  return { ...resource, harness_scope: scope };
}
