import type { ProfileDetail } from "./types";

/** One attachment a profile gained; the detach body that removes exactly it. */
export type ProfileAttachmentRef =
  | { dependencyName: string }
  | { resourceId: string };

/**
 * Attachments present in `after` but not in `before`. Undo removes only these,
 * so anything the profile already had stays put.
 */
export function addedProfileAttachments(
  before: Pick<ProfileDetail, "dependencies" | "resources">,
  after: Pick<ProfileDetail, "dependencies" | "resources">,
): ProfileAttachmentRef[] {
  const beforeDeps = new Set(before.dependencies.map((dep) => dep.dependency_name));
  const beforeResources = new Set(before.resources.map((resource) => resource.id));
  const added: ProfileAttachmentRef[] = [];
  const addedDepNames = new Set<string>();
  for (const dep of after.dependencies) {
    if (!beforeDeps.has(dep.dependency_name)) {
      addedDepNames.add(dep.dependency_name);
      added.push({ dependencyName: dep.dependency_name });
    }
  }
  for (const resource of after.resources) {
    if (beforeResources.has(resource.id)) {
      continue;
    }
    // Detaching the dependency already removes its plugin ref.
    if (resource.type === "plugin" && addedDepNames.has(resource.name)) {
      continue;
    }
    added.push({ resourceId: resource.id });
  }
  return added;
}
