import { parseVersionConstraint } from "../../plugin-constraints.js";
import type { LayerDoctorCheckResult, LayerDoctorContext } from "../layer-doctor.types.js";

export const pluginMetadataCheck = {
  id: "plugin-metadata",
  description: "Validate plugin refs, versions, and Claude plugin metadata",
  run({ layer, plugins }: LayerDoctorContext): LayerDoctorCheckResult[] {
    const results: LayerDoctorCheckResult[] = [];

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

    if (layer.claude?.marketplaces) {
      for (const [name, entry] of Object.entries(layer.claude.marketplaces)) {
        const source = entry.source?.source;
        if (!source) {
          results.push({
            severity: "warn",
            message: `Marketplace "${name}" has no source type`,
          });
        }
      }
    }

    if (layer.claude?.plugins) {
      for (const plugin of layer.claude.plugins) {
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
