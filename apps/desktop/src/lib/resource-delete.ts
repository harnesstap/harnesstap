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
