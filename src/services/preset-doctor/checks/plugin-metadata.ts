import { parseVersionConstraint } from "../../plugin-constraints.js";
import type { PresetDoctorCheckResult, PresetDoctorContext } from "../preset-doctor.types.js";

export const pluginMetadataCheck = {
  id: "plugin-metadata",
  description: "Validate plugin refs, versions, and Claude plugin metadata",
  run({ preset, plugins }: PresetDoctorContext): PresetDoctorCheckResult[] {
    const results: PresetDoctorCheckResult[] = [];

    for (const pin of plugins) {
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

    if (preset.claude?.marketplaces) {
      for (const [name, entry] of Object.entries(preset.claude.marketplaces)) {
        const source = entry.source?.source;
        if (!source) {
          results.push({
            severity: "warn",
            message: `Marketplace "${name}" has no source type`,
          });
        }
      }
    }

    if (preset.claude?.plugins) {
      for (const plugin of preset.claude.plugins) {
        if (!plugin.id.includes("@")) {
          results.push({
            severity: "warn",
            message: `Claude plugin id should be ref@marketplace: ${plugin.id}`,
          });
        }
      }
    }

    return results;
  },
};
