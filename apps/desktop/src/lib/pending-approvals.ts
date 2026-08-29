export type PendingExecType = "hooks" | "bin" | "mcp";

export interface PendingApprovalItem {
  ref: string;
  types: PendingExecType[];
}

export interface ExecutableTrustFields {
  optedIn?: boolean;
  warnings?: string[];
  parked?: PendingApprovalItem[];
  execStatuses?: Record<string, string>;
}

const EXEC_TYPES = new Set<PendingExecType>(["hooks", "bin", "mcp"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTypes(value: unknown): PendingExecType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const types: PendingExecType[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && EXEC_TYPES.has(entry as PendingExecType)) {
      types.push(entry as PendingExecType);
    }
  }
  return types;
}

function parseParked(value: unknown): PendingApprovalItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const items: PendingApprovalItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.ref !== "string") {
      continue;
    }
    const ref = entry.ref.trim();
    if (ref.length === 0) {
      continue;
    }
    items.push({
      ref,
      types: parseTypes(entry.types),
    });
  }
  return items;
}

export function trustFieldsFromUnknown(value: unknown): ExecutableTrustFields | null {
  if (!isRecord(value)) {
    return null;
  }
  const parked = parseParked(value.parked);
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((entry): entry is string => typeof entry === "string")
    : [];
  const execStatuses = isRecord(value.execStatuses)
    ? Object.fromEntries(
        Object.entries(value.execStatuses).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
  return {
    optedIn: value.optedIn === true,
    warnings,
    parked,
    execStatuses,
  };
}

export function pendingApprovalsFromTrust(
  fields: ExecutableTrustFields | null | undefined,
): PendingApprovalItem[] {
  if (!fields?.optedIn) {
    return [];
  }
  return fields.parked ?? [];
}

export function shouldShowPendingApprovalsStrip(
  fields: ExecutableTrustFields | null | undefined,
): boolean {
  return pendingApprovalsFromTrust(fields).length > 0;
}

export function pendingApprovalCliHint(refs: string[]): {
  approve: string;
  deny: string;
} {
  return {
    approve: refs.length === 0 ? "ht approve <PACKAGE_REF>" : `ht approve ${refs.join(" ")}`,
    deny: refs.length === 0 ? "ht deny <PACKAGE_REF>" : `ht deny ${refs.join(" ")}`,
  };
}
