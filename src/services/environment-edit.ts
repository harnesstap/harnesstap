import {
  getEnvironmentResources,
  getEnvironmentSecretRefs,
} from "../models/environment.js";
import type {
  EnvVarMetadata,
  ModelConfigMetadata,
  PermissionMetadata,
} from "../types.js";

export type EnvironmentEditRow =
  | { kind: "env_var"; key: string; value: string }
  | { kind: "secret_ref"; key: string; provider: string; ref: string }
  | { kind: "model_config"; name: string; model: string; provider?: string }
  | { kind: "permission"; name: string; action: string; pattern: string };

const KIND_ORDER: EnvironmentEditRow["kind"][] = [
  "env_var",
  "secret_ref",
  "model_config",
  "permission",
];

function kindSortIndex(kind: EnvironmentEditRow["kind"]): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

function compareEnvironmentEditRows(
  left: EnvironmentEditRow,
  right: EnvironmentEditRow,
): number {
  const kindDelta = kindSortIndex(left.kind) - kindSortIndex(right.kind);
  if (kindDelta !== 0) {
    return kindDelta;
  }

  switch (left.kind) {
    case "env_var":
      return left.key.localeCompare(
        right.kind === "env_var" ? right.key : "",
      );
    case "secret_ref":
      return left.key.localeCompare(
        right.kind === "secret_ref" ? right.key : "",
      );
    case "model_config":
      return left.name.localeCompare(
        right.kind === "model_config" ? right.name : "",
      );
    case "permission":
      return left.name.localeCompare(
        right.kind === "permission" ? right.name : "",
      );
    default: {
      const neverRow: never = left;
      throw new Error(`Unsupported row kind: ${String(neverRow)}`);
    }
  }
}

export function buildEnvironmentEditRows(environmentId: string): EnvironmentEditRow[] {
  const rows: EnvironmentEditRow[] = [];

  for (const resource of getEnvironmentResources(environmentId)) {
    if (resource.type === "env_var") {
      const metadata = resource.metadata as EnvVarMetadata;
      rows.push({
        kind: "env_var",
        key: metadata.key,
        value: metadata.value,
      });
      continue;
    }

    if (resource.type === "model_config") {
      const metadata = resource.metadata as ModelConfigMetadata;
      rows.push({
        kind: "model_config",
        name: resource.name,
        model: metadata.model,
        ...(metadata.provider ? { provider: metadata.provider } : {}),
      });
      continue;
    }

    if (resource.type === "permission") {
      const metadata = resource.metadata as PermissionMetadata;
      rows.push({
        kind: "permission",
        name: resource.name,
        action: metadata.action,
        pattern: metadata.pattern,
      });
    }
  }

  for (const secretRef of getEnvironmentSecretRefs(environmentId)) {
    rows.push({
      kind: "secret_ref",
      key: secretRef.key,
      provider: secretRef.provider,
      ref: secretRef.ref,
    });
  }

  return rows.sort(compareEnvironmentEditRows);
}
