import { getPlugin, getPluginResources } from "../models/plugin-model.js";
import { listDependencies } from "./plugin-dependency.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { parseVersionConstraint } from "./plugin-constraints.js";

export interface PluginValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface PluginValidationReport {
  plugin: string;
  valid: boolean;
  issues: PluginValidationIssue[];
}

const PLATFORM_IDS = new Set(getAllPlatforms().map((p) => p.id));

export function validatePlugin(nameOrId: string): PluginValidationReport {
  const plugin = getPlugin(nameOrId);
  const issues: PluginValidationIssue[] = [];

  if (!plugin) {
    return {
      plugin: nameOrId,
      valid: false,
      issues: [
        {
          severity: "error",
          code: "plugin_not_found",
          message: `Plugin not found: ${nameOrId}`,
        },
      ],
    };
  }

  const resources = getPluginResources(plugin.id);
  if (resources.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_plugin",
      message: "Plugin has no resources",
    });
  }

  const seen = new Set<string>();
  for (const resource of resources) {
    const key = `${resource.type}:${resource.name}`;
    if (seen.has(key)) {
      issues.push({
        severity: "error",
        code: "duplicate_resource",
        message: `Duplicate resource in plugin: ${key}`,
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

  const plugins = listDependencies(plugin.id);
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

  if (plugin.claude?.marketplaces) {
    for (const [name, entry] of Object.entries(plugin.claude.marketplaces)) {
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

  if (plugin.claude?.plugins) {
    for (const entry of plugin.claude.plugins) {
      if (!entry.id.includes("@")) {
        issues.push({
          severity: "warning",
          code: "claude_plugin_id_format",
          message: `Claude plugin id should be ref@marketplace: ${entry.id}`,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return {
    plugin: plugin.name,
    valid: !hasErrors,
    issues,
  };
}

/** Exported for tests; validates harness slug strings in plugins if needed later. */
export function isKnownPlatformId(platformId: string): boolean {
  return PLATFORM_IDS.has(platformId);
}
