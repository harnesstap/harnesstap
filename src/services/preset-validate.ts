import { getPreset, getPresetResources } from "../models/preset.js";
import { listPresetPlugins } from "../models/plugin.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { parseVersionConstraint } from "./plugin-constraints.js";

export interface PresetValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface PresetValidationReport {
  preset: string;
  valid: boolean;
  issues: PresetValidationIssue[];
}

const PLATFORM_IDS = new Set(getAllPlatforms().map((p) => p.id));

export function validatePreset(nameOrId: string): PresetValidationReport {
  const preset = getPreset(nameOrId);
  const issues: PresetValidationIssue[] = [];

  if (!preset) {
    return {
      preset: nameOrId,
      valid: false,
      issues: [
        {
          severity: "error",
          code: "preset_not_found",
          message: `Preset not found: ${nameOrId}`,
        },
      ],
    };
  }

  const resources = getPresetResources(preset.id);
  if (resources.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_preset",
      message: "Preset has no resources",
    });
  }

  const seen = new Set<string>();
  for (const resource of resources) {
    const key = `${resource.type}:${resource.name}`;
    if (seen.has(key)) {
      issues.push({
        severity: "error",
        code: "duplicate_resource",
        message: `Duplicate resource in preset: ${key}`,
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

  const plugins = listPresetPlugins(preset.id);
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

  if (preset.claude?.marketplaces) {
    for (const [name, entry] of Object.entries(preset.claude.marketplaces)) {
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

  if (preset.claude?.plugins) {
    for (const plugin of preset.claude.plugins) {
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
    preset: preset.name,
    valid: !hasErrors,
    issues,
  };
}

/** Exported for tests; validates harness slug strings in presets if needed later. */
export function isKnownPlatformId(platformId: string): boolean {
  return PLATFORM_IDS.has(platformId);
}
