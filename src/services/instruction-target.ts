import { getAllPlatforms } from "../platforms/registry.js";
import type { Resource } from "../types.js";
import { sourceMatchesManagedPath } from "./mcp-target.js";

function stripHomePrefix(path: string): string {
  return path.replace(/\\/g, "/").replace(/^~\//, "");
}

function collectKnownInstructionPaths(): string[] {
  const paths: string[] = ["~/.agents/AGENTS.md", ".agents/AGENTS.md"];
  for (const platform of getAllPlatforms()) {
    for (const candidate of [
      platform.projectPaths.instructions,
      platform.projectPaths.legacy_instructions,
      platform.globalPaths.instructions,
    ]) {
      if (candidate) {
        paths.push(candidate);
      }
    }
    for (const related of platform.relatedLocations ?? []) {
      if (related.surfaces.includes("instructions")) {
        paths.push(related.path);
      }
    }
  }
  return [...new Set(paths.map(stripHomePrefix))];
}

function sourcePointsAtKnownInstructionPath(source: string): boolean {
  return collectKnownInstructionPaths().some((path) =>
    sourceMatchesManagedPath(source, path),
  );
}

function isPortableInstructionSource(source: string | undefined): boolean {
  const trimmed = source?.trim();
  return !trimmed || trimmed === "manual";
}

/** Instructions that belong on this harness instruction path. */
export function filterInstructionsForTargetPath(
  resources: Resource[],
  allowedPaths: string[],
): Resource[] {
  return resources.filter((resource) => {
    if (resource.type !== "instruction") {
      return false;
    }
    if (isPortableInstructionSource(resource.source)) {
      return true;
    }
    if (allowedPaths.some((path) => sourceMatchesManagedPath(resource.source, path))) {
      return true;
    }
    if (sourcePointsAtKnownInstructionPath(resource.source ?? "")) {
      return false;
    }
    return true;
  });
}
