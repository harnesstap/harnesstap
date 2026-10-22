import { parseVersionConstraint } from "../../plugin-constraints.js";
import { gitDependencyPinIssue } from "../../git-dependency-pin-check.js";
import type { PluginDoctorCheckResult, PluginDoctorContext } from "../plugin-doctor.types.js";

function checkGitDependencyPin(ref: string, constraint: string): PluginDoctorCheckResult[] {
  const issue = gitDependencyPinIssue(ref, constraint);
  return issue ? [{ severity: issue.severity === "error" ? "error" : "warn", message: issue.message }] : [];
}

export const pluginMetadataCheck = {
  id: "plugin-metadata",
  description: "Validate plugin refs, versions, and Claude plugin metadata",
  run({ plugin, plugins }: PluginDoctorContext): PluginDoctorCheckResult[] {
    const results: PluginDoctorCheckResult[] = [];

    for (const pin of plugins) {
      if (pin.source_kind === "git") {
        results.push(...checkGitDependencyPin(pin.ref, pin.version_constraint));
        continue;
      }
      if (!pin.ref.includes("@")) {
        results.push({
          severity: "error",
          message: `Plugin ref must include marketplace: ${pin.ref}`,
        });
      }

      try {
        parseVersionConstraint(pin.version_constraint);
      } catch (err) {
        results.push({
          severity: "error",
          message:
            err instanceof Error
              ? err.message
              : `Invalid version constraint for ${pin.ref}`,
        });
      }
    }

    if (plugin.claude?.marketplaces) {
      for (const [name, entry] of Object.entries(plugin.claude.marketplaces)) {
        const source = entry.source?.source;
        if (!source) {
          results.push({
            severity: "warn",
            message: `Marketplace "${name}" has no source type`,
          });
        }
      }
    }

    if (plugin.claude?.plugins) {
      for (const entry of plugin.claude.plugins) {
        if (!entry.id.includes("@")) {
          results.push({
            severity: "warn",
            message: `Claude plugin id should be ref@marketplace: ${entry.id}`,
          });
        }
      }
    }

    return results;
  },
};
