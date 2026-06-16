import type { ResourceCreateInput } from "../types.js";

export function resourceIdentity(
  resource: Pick<ResourceCreateInput, "type" | "name" | "namespace">,
): string {
  return `${resource.type}:${resource.name}:${resource.namespace ?? ""}`;
}

/** Merge plugin resources into main scan without duplicate type:name:namespace keys. */
export function mergeReferenceResourceInputs(
  main: ResourceCreateInput[],
  supplemental: ResourceCreateInput[],
): ResourceCreateInput[] {
  const seen = new Set(main.map(resourceIdentity));
  const merged = [...main];
  for (const resource of supplemental) {
    const key = resourceIdentity(resource);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(resource);
  }
  return merged;
}

export function mainScanLacksPluginSkills(
  main: ResourceCreateInput[],
  plugin: ResourceCreateInput[],
): boolean {
  const mainHasSkills = main.some((r) => r.type === "skill");
  const pluginHasSkills = plugin.some((r) => r.type === "skill");
  return !mainHasSkills && pluginHasSkills;
}
