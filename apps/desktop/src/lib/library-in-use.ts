import type { LibraryListEntry } from "./library-list";
import type { ProfileDetail, ProfileSummary, ViewScope } from "./types";

export type LibraryInUseKind = "none" | "project" | "global" | "both";

export interface LibraryInUseMembership {
  onGlobal: boolean;
  projectCount: number;
}

export interface LibraryInUseProfile {
  name: string;
  scopes: ViewScope[];
}

export interface LibraryInUseComposition {
  profileName: string;
  memberKeys: string[];
}

export interface LibraryInUseProjectBinding {
  /** Project directory path used as a distinct project id. */
  path: string;
  profileNames: string[];
}

const unused: LibraryInUseMembership = { onGlobal: false, projectCount: 0 };

export function libraryInUseKind(
  membership: LibraryInUseMembership,
): LibraryInUseKind {
  if (membership.onGlobal && membership.projectCount > 0) {
    return "both";
  }
  if (membership.onGlobal) {
    return "global";
  }
  if (membership.projectCount > 0) {
    return "project";
  }
  return "none";
}

function inProjectsCopy(count: number): string {
  return count === 1 ? "In 1 project" : `In ${count} projects`;
}

function inProjectsLower(count: number): string {
  return count === 1 ? "in 1 project" : `in ${count} projects`;
}

export function libraryInUseTooltip(
  membership: LibraryInUseMembership,
): string | null {
  const kind = libraryInUseKind(membership);
  switch (kind) {
    case "none":
      return null;
    case "project":
      return inProjectsCopy(membership.projectCount);
    case "global":
      return "On Global";
    case "both":
      return `On Global · ${inProjectsLower(membership.projectCount)}`;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

export function libraryInUseMemberKeysFromDetail(
  detail: ProfileDetail,
): string[] {
  const keys = new Set<string>();
  for (const resource of detail.resources) {
    keys.add(libraryInUseResourceIdKey(resource.id));
    keys.add(libraryInUseResourceTypeKey(resource.type, resource.name));
  }
  for (const dependency of detail.dependencies) {
    keys.add(libraryInUsePluginNameKey(dependency.dependency_name));
    if (dependency.resource_id) {
      keys.add(libraryInUseResourceIdKey(dependency.resource_id));
    }
  }
  return [...keys];
}

export function libraryInUseResourceIdKey(id: string): string {
  return `id:${id}`;
}

export function libraryInUseResourceTypeKey(type: string, name: string): string {
  return `resource:${type}:${name}`;
}

export function libraryInUsePluginNameKey(name: string): string {
  return `plugin:${name}`;
}

export function libraryInUseEntryKeys(
  entry: Pick<LibraryListEntry, "id" | "name" | "type" | "listKind">,
): string[] {
  if (entry.listKind === "plugin-package") {
    return [
      libraryInUseResourceIdKey(entry.id),
      libraryInUsePluginNameKey(entry.name),
    ];
  }
  return [
    libraryInUseResourceIdKey(entry.id),
    libraryInUseResourceTypeKey(entry.type, entry.name),
  ];
}

export function mergeProfileScopes(
  profiles: LibraryInUseProfile[],
): Map<string, ViewScope[]> {
  const byName = new Map<string, ViewScope[]>();
  for (const profile of profiles) {
    const existing = byName.get(profile.name);
    if (!existing) {
      byName.set(profile.name, [...profile.scopes]);
      continue;
    }
    for (const scope of profile.scopes) {
      if (!existing.includes(scope)) {
        existing.push(scope);
      }
    }
  }
  return byName;
}

/**
 * Index Library in-use marks from profile composition and Global/Project scopes.
 * `projectCount` is distinct project paths whose project-enabled profiles include the row.
 */
export function indexLibraryInUse(input: {
  profiles: LibraryInUseProfile[];
  compositions: LibraryInUseComposition[];
  projectBindings: LibraryInUseProjectBinding[];
}): Map<string, LibraryInUseMembership> {
  const scopesByName = mergeProfileScopes(input.profiles);
  const membersByProfile = new Map<string, Set<string>>();
  for (const composition of input.compositions) {
    membersByProfile.set(composition.profileName, new Set(composition.memberKeys));
  }

  const globalProfiles = [...scopesByName.entries()]
    .filter(([, scopes]) => scopes.includes("home"))
    .map(([name]) => name);

  const buckets = new Map<
    string,
    { onGlobal: boolean; projectPaths: Set<string> }
  >();

  function bucket(key: string): { onGlobal: boolean; projectPaths: Set<string> } {
    const existing = buckets.get(key);
    if (existing) {
      return existing;
    }
    const created = { onGlobal: false, projectPaths: new Set<string>() };
    buckets.set(key, created);
    return created;
  }

  function markKeys(keys: Iterable<string>, hit: { onGlobal?: boolean; projectPath?: string }): void {
    for (const key of keys) {
      const next = bucket(key);
      if (hit.onGlobal) {
        next.onGlobal = true;
      }
      if (hit.projectPath) {
        next.projectPaths.add(hit.projectPath);
      }
    }
  }

  for (const profileName of globalProfiles) {
    const members = membersByProfile.get(profileName);
    if (!members || members.size === 0) {
      continue;
    }
    markKeys(members, { onGlobal: true });
  }

  for (const binding of input.projectBindings) {
    for (const profileName of binding.profileNames) {
      const scopes = scopesByName.get(profileName);
      if (!scopes?.includes("project")) {
        continue;
      }
      const members = membersByProfile.get(profileName);
      if (!members || members.size === 0) {
        continue;
      }
      markKeys(members, { projectPath: binding.path });
    }
  }

  const index = new Map<string, LibraryInUseMembership>();
  for (const [key, value] of buckets) {
    index.set(key, {
      onGlobal: value.onGlobal,
      projectCount: value.projectPaths.size,
    });
  }
  return index;
}

export function libraryInUseForEntry(
  entry: Pick<LibraryListEntry, "id" | "name" | "type" | "listKind">,
  index: Map<string, LibraryInUseMembership>,
): LibraryInUseMembership {
  let onGlobal = false;
  let projectCount = 0;
  for (const key of libraryInUseEntryKeys(entry)) {
    const hit = index.get(key);
    if (!hit) {
      continue;
    }
    onGlobal = onGlobal || hit.onGlobal;
    if (hit.projectCount > projectCount) {
      projectCount = hit.projectCount;
    }
  }
  if (!onGlobal && projectCount === 0) {
    return unused;
  }
  return { onGlobal, projectCount };
}

export function libraryInUseProfilesFromSummaries(
  summaries: ProfileSummary[],
): LibraryInUseProfile[] {
  return summaries.map((profile) => ({
    name: profile.name,
    scopes: profile.scopes,
  }));
}

export function libraryInUseCompositionsFromDetails(
  details: Array<{ profileName: string; detail: ProfileDetail }>,
): LibraryInUseComposition[] {
  return details.map((entry) => ({
    profileName: entry.profileName,
    memberKeys: libraryInUseMemberKeysFromDetail(entry.detail),
  }));
}

export function libraryInUseProjectBindingsFromListings(
  listings: Array<{ path: string; profiles: LibraryInUseProfile[] }>,
): LibraryInUseProjectBinding[] {
  return listings
    .filter((listing) => listing.path.trim().length > 0)
    .map((listing) => ({
      path: listing.path,
      profileNames: listing.profiles
        .filter((profile) => profile.scopes.includes("project"))
        .map((profile) => profile.name),
    }));
}

export function uniqueLibraryInUseProjectPaths(
  currentPath: string,
  recentPaths: string[],
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of [currentPath, ...recentPaths]) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    paths.push(trimmed);
  }
  return paths;
}
