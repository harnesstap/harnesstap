import type { PluginSourceScanResult } from "../types.js";
import type { ScanResult } from "./scanner.js";

function normalizeSource(source: string): string {
  return source.replace(/^\.\//, "");
}

export function dropHarnessSkillsDuplicatingPluginSource(
  harness: ScanResult[],
  plugin: PluginSourceScanResult[],
): ScanResult[] {
  const pluginSkillSources = new Set(
    plugin
      .flatMap((entry) => entry.resources)
      .filter((r) => r.type === "skill")
      .map((r) => normalizeSource(r.source)),
  );

  if (pluginSkillSources.size === 0) {
    return harness;
  }

  return harness.map((result) => ({
    ...result,
    resources: result.resources.filter((resource) => {
      if (resource.type !== "skill") return true;
      return !pluginSkillSources.has(normalizeSource(resource.source));
    }),
  }));
}
