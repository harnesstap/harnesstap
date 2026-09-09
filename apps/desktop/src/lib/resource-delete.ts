import type { ResourceDeletePlan } from "./api/resource-mutate";

export interface ResourceAttachers {
  profiles: string[];
  plugins: string[];
  active_profile: string | null;
  in_active_profile: boolean;
}

export function attachersFromResourceDetail(detail: {
  attached_profiles?: string[];
  attached_plugins?: string[];
  active_profile?: string | null;
  in_active_profile?: boolean;
}): ResourceAttachers {
  return {
    profiles: detail.attached_profiles ?? [],
    plugins: detail.attached_plugins ?? [],
    active_profile: detail.active_profile ?? null,
    in_active_profile: detail.in_active_profile === true,
  };
}

export function formatResourceDeleteAttachers(attachers: ResourceAttachers): {
  profilesLine: string | null;
  pluginsLine: string | null;
  emptyLine: string | null;
} {
  const profilesLine =
    attachers.profiles.length > 0
      ? `Profiles: ${attachers.profiles.join(", ")}`
      : null;
  const pluginsLine =
    attachers.plugins.length > 0
      ? `Plugins: ${attachers.plugins.join(", ")}`
      : null;
  return {
    profilesLine,
    pluginsLine,
    emptyLine:
      profilesLine === null && pluginsLine === null
        ? "No profiles or plugins currently attach this resource."
        : null,
  };
}

export function resourceCanRemoveFromActiveProfile(
  attachers: ResourceAttachers,
): boolean {
  return Boolean(attachers.active_profile) && attachers.in_active_profile;
}

export const RESOURCE_DELETE_LIBRARY_LABEL = "Delete from library";
export const RESOURCE_DELETE_DISK_LABEL = "Delete from library + disk";

export function resourceDeleteDiskDisabled(plan: ResourceDeletePlan | null): boolean {
  if (!plan) {
    return true;
  }
  return !plan.can_delete_from_disk || plan.blockers.length > 0;
}

const DISK_DELETE_REASON_COPY: Record<string, string> = {
  "Modified file is protected":
    "HarnessTap will not delete this on-disk copy because it was edited outside the library.",
  "Path escapes declared root":
    "This path is outside the expected install root, so disk delete is blocked.",
  "Refusing to delete root directory":
    "This path is a root directory, so HarnessTap will not delete it.",
  "Path no longer exists":
    "The recorded on-disk path is missing, so disk delete cannot run.",
  "Shared file section cannot be identified":
    "This file is shared with other resources, and HarnessTap cannot safely edit only this section.",
};

export function humanizeDiskDeleteReason(reason: string): string {
  return DISK_DELETE_REASON_COPY[reason] ?? reason;
}

export function diskDeleteDisabledExplanation(
  plan: ResourceDeletePlan | null,
): string | null {
  if (!plan || !resourceDeleteDiskDisabled(plan)) {
    return null;
  }
  const reasons = [
    ...new Set(plan.blockers.map((reason) => humanizeDiskDeleteReason(reason))),
  ];
  const detail =
    reasons.length > 0
      ? reasons.join(" ")
      : "One or more on-disk locations are protected.";
  return `Delete from library + disk is unavailable. ${detail} Delete from library still removes the library entry.`;
}

export function protectedDeleteLocations(
  plan: ResourceDeletePlan,
): ResourceDeletePlan["locations"] {
  return plan.locations.filter((location) => location.action === "protected");
}

export function formatResourceDeletePlanSummary(plan: ResourceDeletePlan): {
  groups: Array<{
    scope: "global" | "project" | "source";
    label: string;
    locations: ResourceDeletePlan["locations"];
  }>;
  emptyMessage: string | null;
  blockers: string[];
} {
  const order = ["global", "project", "source"] as const;
  const labels = {
    global: "Global",
    project: "Projects",
    source: "Source",
  } as const;
  const groups = order
    .map((scope) => ({
      scope,
      label: labels[scope],
      locations: plan.locations.filter((location) => location.scope === scope),
    }))
    .filter((group) => group.locations.length > 0);

  return {
    groups,
    emptyMessage:
      plan.locations.length === 0
        ? "No on-disk locations were found for this resource."
        : null,
    blockers: plan.blockers.map((reason) => humanizeDiskDeleteReason(reason)),
  };
}

export function formatResourceDeleteSuccess(
  mode: "library" | "library_and_disk",
  quote: string,
  result: { deleted_files: string[]; edited_files: string[] },
): string {
  if (mode === "library") {
    return `Deleted ${quote}`;
  }
  const deleted = result.deleted_files.length;
  const edited = result.edited_files.length;
  return `Deleted ${quote} from library and disk (${deleted} deleted, ${edited} edited)`;
}
