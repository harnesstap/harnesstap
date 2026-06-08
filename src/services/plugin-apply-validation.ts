import { listLayerPlugins } from "../models/plugin-pins.js";
import { findPluginResourceByPin } from "./composition-resource.js";
import { satisfiesConstraint } from "./plugin-constraints.js";
import type { PluginResourceMetadata } from "../types.js";

export interface PluginValidationIssue {
  ref: string;
  constraint: string;
  installed: string;
  message: string;
}

interface PluginConstraintPin {
  ref: string;
  version_constraint: string;
}

function validatePluginConstraintPins(
  rows: PluginConstraintPin[],
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];

  for (const row of rows) {
    if (!row.version_constraint) {
      continue;
    }

    const resource = findPluginResourceByPin(row.ref, row.version_constraint);
    const metadata = (resource?.metadata ?? {}) as PluginResourceMetadata;
    const resolved = metadata.resolved_version;

    if (!resolved) {
      issues.push({
        ref: row.ref,
        constraint: row.version_constraint,
        installed: "never_synced",
        message: `Plugin ${row.ref} has no resolved version. Run: harnessdeck resource sync plugin:${row.ref}`,
      });
      continue;
    }

    if (satisfiesConstraint(row.version_constraint, resolved)) {
      continue;
    }

    issues.push({
      ref: row.ref,
      constraint: row.version_constraint,
      installed: resolved,
      message: `Plugin version mismatch: ${row.ref} requires ${row.version_constraint}, library has ${resolved}. Run: harnessdeck resource sync plugin:${row.ref}`,
    });
  }

  return issues;
}

export function validateLayerPluginConstraints(layerId: string): PluginValidationIssue[] {
  return validatePluginConstraintPins(listLayerPlugins(layerId));
}

export function validatePluginPinsAgainstInventory(
  pins: PluginConstraintPin[],
): PluginValidationIssue[] {
  return validatePluginConstraintPins(pins);
}
