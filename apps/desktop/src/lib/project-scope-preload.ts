import {
  applyProfileRailOrder,
  pinNameFirst,
  resolveRailProfileSelection,
} from "./profile-rail-order";
import type { ProfileSummary } from "./types";
import type { Scope } from "./api/scope";

const EMPTY_PROFILE = "empty";

export interface ScopePreviewKey {
  scope: Scope;
  projectPath: string | null;
  profile: string;
}

function visibleNamesForView(
  profiles: readonly ProfileSummary[],
  view: "home" | "project",
  railOrder: readonly string[],
  activeProfile: string | null,
): string[] {
  const scoped = profiles.filter(
    (profile) => profile.scopes?.includes(view) && profile.name !== EMPTY_PROFILE,
  );
  return pinNameFirst(
    applyProfileRailOrder(
      scoped.map((profile) => profile.name),
      railOrder,
    ),
    activeProfile ?? undefined,
  );
}

/** Profile the Project rail would select on first open (active if in-scope, else first). */
export function projectScopePreloadKey(input: {
  projectPath: string;
  profiles: readonly ProfileSummary[];
  activeProfile: string | null;
  railOrder?: readonly string[];
}): ScopePreviewKey | null {
  const projectPath = input.projectPath.trim();
  if (!projectPath) {
    return null;
  }
  const visibleNames = visibleNamesForView(
    input.profiles,
    "project",
    input.railOrder ?? [],
    input.activeProfile,
  );
  const profile = resolveRailProfileSelection({
    visibleNames,
    activeName: input.activeProfile,
    selectedName: null,
    intent: "unset",
  });
  if (!profile) {
    return null;
  }
  return { scope: "project", projectPath, profile };
}

export function homeScopePreviewKey(input: {
  profiles: readonly ProfileSummary[];
  activeProfile: string | null;
  railOrder?: readonly string[];
}): ScopePreviewKey | null {
  const visibleNames = visibleNamesForView(
    input.profiles,
    "home",
    input.railOrder ?? [],
    input.activeProfile,
  );
  const profile = resolveRailProfileSelection({
    visibleNames,
    activeName: input.activeProfile,
    selectedName: null,
    intent: "unset",
  });
  if (!profile) {
    return null;
  }
  return { scope: "global", projectPath: null, profile };
}

export function isPreviewSettled(entry: {
  data: unknown;
  error: string | null;
} | undefined): boolean {
  if (!entry) {
    return false;
  }
  return entry.data !== null || entry.error !== null;
}

/**
 * Start project apply-preview only after profiles are known and Global inventory
 * is settled, so the first Global open is not competing with a project scan.
 */
export function shouldStartProjectScopePreload(input: {
  connected: boolean;
  switching: boolean;
  projectPath: string;
  profilesRefreshing: boolean;
  projectKey: ScopePreviewKey | null;
  projectPreviewRefreshing: boolean;
  projectPreviewSettled: boolean;
  homePreviewSettled: boolean;
}): boolean {
  if (!input.connected || input.switching) {
    return false;
  }
  if (!input.projectPath.trim() || input.profilesRefreshing) {
    return false;
  }
  if (!input.projectKey) {
    return false;
  }
  if (input.projectPreviewRefreshing || input.projectPreviewSettled) {
    return false;
  }
  return input.homePreviewSettled;
}
