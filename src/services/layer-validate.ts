import { getLayer, getLayerResources } from "../models/plugin-model.js";
import { listLayerPlugins } from "../services/layer-composition.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { parseVersionConstraint } from "./plugin-constraints.js";

export interface LayerValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface LayerValidationReport {
  layer: string;
  valid: boolean;
  issues: LayerValidationIssue[];
}

const PLATFORM_IDS = new Set(getAllPlatforms().map((p) => p.id));

export function validateLayer(nameOrId: string): LayerValidationReport {
  const layer = getLayer(nameOrId);
  const issues: LayerValidationIssue[] = [];

  if (!layer) {
    return {
      layer: nameOrId,
      valid: false,
      issues: [
        {
          severity: "error",
          code: "layer_not_found",
          message: `Layer not found: ${nameOrId}`,
        },
      ],
    };
  }

  const resources = getLayerResources(layer.id);
  if (resources.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_layer",
      message: "Layer has no resources",
    });
  }

  const seen = new Set<string>();
  for (const resource of resources) {
    const key = `${resource.type}:${resource.name}`;
    if (seen.has(key)) {
      issues.push({
        severity: "error",
        code: "duplicate_resource",
        message: `Duplicate resource in layer: ${key}`,
      });
    }
    seen.add(key);
    if (!resource.content.trim()) {
      issues.push({
        severity: "warning",
        code: "empty_content",
        message: `Resource has empty content: ${key}`,
      });
    }
  }

  const plugins = listLayerPlugins(layer.id);
  for (const pin of plugins) {
    if (!pin.ref.includes("@")) {
      issues.push({
        severity: "error",
        code: "invalid_plugin_ref",
        message: `Plugin ref must include marketplace: ${pin.ref}`,
      });
    }
    try {
      parseVersionConstraint(pin.version_constraint);
    } catch (err) {
      issues.push({
        severity: "error",
        code: "invalid_version_constraint",
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
        issues.push({
          severity: "warning",
          code: "marketplace_missing_source",
          message: `Marketplace "${name}" has no source type`,
        });
      }
    }
  }

  if (layer.claude?.plugins) {
    for (const plugin of layer.claude.plugins) {
      if (!plugin.id.includes("@")) {
        issues.push({
          severity: "warning",
          code: "claude_plugin_id_format",
          message: `Claude plugin id should be ref@marketplace: ${plugin.id}`,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return {
    layer: layer.name,
    valid: !hasErrors,
    issues,
  };
}

/** Exported for tests; validates harness slug strings in layers if needed later. */
export function isKnownPlatformId(platformId: string): boolean {
  return PLATFORM_IDS.has(platformId);
}
