import type { Environment, EnvironmentSecretProvider, PermissionMetadata } from "../../types.js";
import {
  setEnvironmentModelConfigCommand,
  setEnvironmentPermissionCommand,
  setEnvironmentSecretCommand,
  setEnvironmentVarCommand,
  unsetEnvironmentModelConfigCommand,
  unsetEnvironmentPermissionCommand,
  unsetEnvironmentSecretCommand,
  unsetEnvironmentVarCommand,
} from "../environment-commands.js";
import {
  buildEnvironmentEditRows,
  type EnvironmentEditRow,
} from "../environment-edit.js";
import { promptForInteractiveEnvironmentEdit } from "./interactive-environment-edit.js";
import {
  promptForConfirmation,
  promptForValue,
} from "./shared.js";

function parsePermissionEditValue(
  raw: string,
): { action: PermissionMetadata["action"]; pattern: string } {
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx >= raw.length - 1) {
    throw new Error(`Invalid permission "${raw}". Expected action:pattern.`);
  }
  const action = raw.slice(0, idx) as PermissionMetadata["action"];
  if (!["allow", "deny", "ask"].includes(action)) {
    throw new Error(`Invalid permission action "${action}". Use allow, deny, or ask.`);
  }
  return {
    action,
    pattern: raw.slice(idx + 1),
  };
}

async function editEnvironmentRow(
  selector: string,
  row: EnvironmentEditRow,
): Promise<void> {
  switch (row.kind) {
    case "env_var": {
      const value = await promptForValue({
        message: `New value for ${row.key}`,
        default: row.value,
      });
      setEnvironmentVarCommand(selector, row.key, value);
      return;
    }
    case "secret_ref": {
      const ref = await promptForValue({
        message: `New ref for ${row.key}`,
        default: row.ref,
      });
      setEnvironmentSecretCommand(selector, {
        key: row.key,
        provider: row.provider as EnvironmentSecretProvider,
        ref,
      });
      return;
    }
    case "model_config": {
      const model = await promptForValue({
        message: `New model for ${row.name}`,
        default: row.model,
      });
      setEnvironmentModelConfigCommand(selector, {
        name: row.name,
        model,
        ...(row.provider ? { provider: row.provider } : {}),
      });
      return;
    }
    case "permission": {
      const pattern = await promptForValue({
        message: `New action:pattern for ${row.name}`,
        default: `${row.action}:${row.pattern}`,
      });
      const parsed = parsePermissionEditValue(pattern);
      setEnvironmentPermissionCommand(selector, {
        name: row.name,
        ...parsed,
      });
      return;
    }
    default: {
      const neverRow: never = row;
      throw new Error(`Unsupported row kind: ${String(neverRow)}`);
    }
  }
}

async function deleteEnvironmentRow(
  selector: string,
  row: EnvironmentEditRow,
): Promise<void> {
  switch (row.kind) {
    case "env_var":
      unsetEnvironmentVarCommand(selector, row.key);
      return;
    case "secret_ref":
      unsetEnvironmentSecretCommand(selector, row.key);
      return;
    case "model_config":
      unsetEnvironmentModelConfigCommand(selector, row.name);
      return;
    case "permission":
      unsetEnvironmentPermissionCommand(selector, {
        name: row.name,
        action: row.action as PermissionMetadata["action"],
        pattern: row.pattern,
      });
      return;
    default: {
      const neverRow: never = row;
      throw new Error(`Unsupported row kind: ${String(neverRow)}`);
    }
  }
}

function formatEnvironmentLabel(environment: Pick<Environment, "name">): string {
  return environment.name;
}

export async function runEnvironmentEditWizard(input: {
  environment: Environment;
}): Promise<EnvironmentEditRow[] | undefined> {
  const selector = input.environment.name;

  while (true) {
    const rows = buildEnvironmentEditRows(input.environment.id);
    const action = await promptForInteractiveEnvironmentEdit({
      message: `Edit environment ${formatEnvironmentLabel(input.environment)}`,
      rows,
    });

    if (action.type === "quit") {
      return buildEnvironmentEditRows(input.environment.id);
    }

    if (action.type === "add") {
      const key = await promptForValue({ message: "Env var key" });
      const value = await promptForValue({ message: `Value for ${key}` });
      setEnvironmentVarCommand(selector, key, value);
      continue;
    }

    const row = rows[action.rowIndex];
    if (!row) {
      continue;
    }

    if (action.type === "edit") {
      await editEnvironmentRow(selector, row);
      continue;
    }

    const confirmed = await promptForConfirmation({
      message: `Delete ${row.kind} ${formatEnvironmentEditRowSummary(row)}?`,
      default: false,
    });
    if (confirmed) {
      await deleteEnvironmentRow(selector, row);
    }
  }
}

function formatEnvironmentEditRowSummary(row: EnvironmentEditRow): string {
  switch (row.kind) {
    case "env_var":
      return row.key;
    case "secret_ref":
      return row.key;
    case "model_config":
      return row.name;
    case "permission":
      return row.name;
    default: {
      const neverRow: never = row;
      throw new Error(`Unsupported row kind: ${String(neverRow)}`);
    }
  }
}

export type { EnvironmentEditRow } from "../environment-edit.js";

export function buildEnvironmentEditSnapshot(environmentId: string): EnvironmentEditRow[] {
  return buildEnvironmentEditRows(environmentId);
}
