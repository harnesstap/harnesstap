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

/** Project-root CLAUDE.md and AGENTS.md are the same shared instruction file. */
function instructionPathAliases(path: string): string[] {
  const normalized = path.replace(/\\/g, "/");
  const aliases = [normalized];
  if (normalized.endsWith("AGENTS.md")) {
    aliases.push(`${normalized.slice(0, -"AGENTS.md".length)}CLAUDE.md`);
  } else if (normalized.endsWith("CLAUDE.md")) {
    aliases.push(`${normalized.slice(0, -"CLAUDE.md".length)}AGENTS.md`);
  }
  return aliases;
}

function expandAllowedInstructionPaths(allowedPaths: string[]): string[] {
  return [...new Set(allowedPaths.flatMap(instructionPathAliases))];
}

/** Instructions that belong on this harness instruction path. */
export function filterInstructionsForTargetPath(
  resources: Resource[],
  allowedPaths: string[],
): Resource[] {
  const allowed = expandAllowedInstructionPaths(allowedPaths);
  return resources.filter((resource) => {
    if (resource.type !== "instruction") {
      return false;
    }
    if (isPortableInstructionSource(resource.source)) {
      return true;
    }
    if (allowed.some((path) => sourceMatchesManagedPath(resource.source, path))) {
      return true;
    }
    if (sourcePointsAtKnownInstructionPath(resource.source ?? "")) {
      return false;
    }
    return true;
  });
}
