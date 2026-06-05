import { listLayerPlugins } from "../models/plugin-pins.js";
import type { ProjectPluginInventory } from "./claude-plugin-inventory.js";
import { satisfiesConstraint } from "./plugin-constraints.js";

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
  inventory: ProjectPluginInventory,
): PluginValidationIssue[] {
  const effectiveByRef = new Map(inventory.effective.map((p) => [p.ref, p]));
  const issues: PluginValidationIssue[] = [];

  for (const row of rows) {
    const installed = effectiveByRef.get(row.ref);
    if (!installed) continue;
    if (satisfiesConstraint(row.version_constraint, installed.version)) continue;
    issues.push({
      ref: row.ref,
      constraint: row.version_constraint,
      installed: installed.version,
      message: `Plugin version mismatch: ${row.ref} requires ${row.version_constraint}, effective is ${installed.version}. Run: claude plugin update ${row.ref}`,
    });
  }

  return issues;
}

/**
 * Validates layer Claude plugin pins against the merged effective inventory.
 * Only compares rows whose `ref` appears in `inventory.effective`.
 */
export function validateLayerPluginConstraints(
  layerId: string,
  inventory: ProjectPluginInventory,
): PluginValidationIssue[] {
  return validatePluginConstraintPins(listLayerPlugins(layerId), inventory);
}

export function validatePluginPinsAgainstInventory(
  pins: PluginConstraintPin[],
  inventory: ProjectPluginInventory,
): PluginValidationIssue[] {
  return validatePluginConstraintPins(pins, inventory);
}
