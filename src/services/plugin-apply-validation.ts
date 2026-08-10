import { findPluginResourceByPin } from "./plugin-composition.js";
import { satisfiesConstraint } from "./plugin-constraints.js";
import type { PluginPinMetadata } from "../types.js";

export interface PluginValidationIssue {
  ref: string;
  constraint: string;
  installed: string;
  message: string;
}

export interface PluginConstraintPin {
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
    const metadata = (resource?.metadata ?? {}) as PluginPinMetadata;
    const resolved = metadata.resolved_version;

    if (!resolved) {
      issues.push({
        ref: row.ref,
        constraint: row.version_constraint,
        installed: "never_synced",
        message: `Plugin pin ${row.ref} has no resolved version. Run: harnesstap resource sync plugin_pin:${row.ref}`,
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
      message: `Plugin pin version mismatch: ${row.ref} requires ${row.version_constraint}, library has ${resolved}. Run: harnesstap resource sync plugin_pin:${row.ref}`,
    });
  }

  return issues;
}

export function validatePluginPinsAgainstInventory(
  pins: PluginConstraintPin[],
): PluginValidationIssue[] {
  return validatePluginConstraintPins(pins);
}
