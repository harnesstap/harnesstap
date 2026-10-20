import { MATERIAL_RESOURCE_TYPES, type MaterialResourceType } from "../../types.js";
import type { ApPackageFiles } from "./files.js";
import { type ParsedApPackage, parseApPackageFiles } from "./import.js";
import type { ApLoadSkipped } from "./spec-load.js";

/** Per resource type: what the package holds versus what the library got. */
export interface PackageResourceCount {
  /** `plugin` counts dependencies, which the library stores as plugin resources. */
  type: MaterialResourceType | "plugin";
  /** Files or entries found in the package for this type, imported or not. */
  discovered: number;
  imported: number;
}

export interface PackageImportDiagnostics {
  skipped: ApLoadSkipped[];
  counts: PackageResourceCount[];
}

function skippedType(component: ApLoadSkipped["component"]): MaterialResourceType {
  switch (component) {
    case "skill":
      return "skill";
    case "mcp":
      return "mcp_server";
    case "rule":
      return "rule";
    case "instruction":
      return "instruction";
    default: {
      const never: never = component;
      throw new Error(`Unknown skipped component: ${String(never)}`);
    }
  }
}

/**
 * Count discovered and imported resources per type. `importedTypes` defaults
 * to the parsed package; doctor passes the library rows instead.
 */
export function diagnoseParsedPackage(
  parsed: ParsedApPackage,
  importedTypes?: readonly string[],
): PackageImportDiagnostics {
  const skipped = parsed.loadReport?.skipped ?? [];
  const parsedTypes = parsed.resources.map((resource) => resource.type);
  const imported = importedTypes ?? parsedTypes;
  const counts: PackageResourceCount[] = [];
  for (const type of MATERIAL_RESOURCE_TYPES) {
    const discovered =
      parsedTypes.filter((entry) => entry === type).length
      + skipped.filter((item) => skippedType(item.component) === type).length;
    const importedCount = imported.filter((entry) => entry === type).length;
    if (discovered === 0 && importedCount === 0) continue;
    counts.push({ type, discovered, imported: importedCount });
  }
  const dependencies = parsed.dependencies.length;
  const importedDependencies = importedTypes
    ? importedTypes.filter((entry) => entry === "plugin").length
    : dependencies;
  if (dependencies > 0 || importedDependencies > 0) {
    counts.push({ type: "plugin", discovered: dependencies, imported: importedDependencies });
  }
  return { skipped, counts };
}

export function diagnosePackageFiles(files: ApPackageFiles): PackageImportDiagnostics {
  return diagnoseParsedPackage(parseApPackageFiles(files));
}

export function formatSkippedEntry(item: ApLoadSkipped): string {
  return `${item.path ?? `${item.component} ${item.name}`}: ${item.reason}`;
}

/** `skill 1 of 3, command 1 of 1`: imported of discovered, per type. */
export function formatResourceCounts(counts: readonly PackageResourceCount[]): string {
  if (counts.length === 0) return "none";
  return counts
    .map((count) => {
      const label = count.type === "plugin" ? "dependency" : count.type.replaceAll("_", " ");
      return `${label} ${count.imported} of ${count.discovered}`;
    })
    .join(", ");
}
