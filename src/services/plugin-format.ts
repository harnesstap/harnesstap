import { getLatestImportedSnapshot } from "../models/imported-snapshot.js";
import type { ImportedSnapshotMetadata, PluginOrigin } from "../types.js";

const FORMAT_LABELS: Record<string, string> = {
  "agent-plugin": "Agent Plugins 1.0",
  "claude-plugin": "Claude plugin",
  "cursor-plugin": "Cursor plugin",
  "codex-plugin": "Codex plugin",
  "copilot-plugin": "Copilot plugin",
  "goose-plugin": "Goose plugin",
  "skill-package": "HarnessTap legacy",
  marketplace: "HarnessTap legacy",
};

export interface PluginImportDiagnostics {
  ok: boolean;
  skipped: Array<{ component: string; name: string; reason: string }>;
  reported: Array<{ field: string; message: string }>;
  legacy_warnings: string[];
  mcp_disabled?: string;
}

export function pluginFormatLabel(
  kind: string | undefined,
  origin: PluginOrigin,
): string {
  if (kind && FORMAT_LABELS[kind]) return FORMAT_LABELS[kind];
  if (origin === "authored") return "HarnessTap";
  return "HarnessTap legacy";
}

function kindFromMetadata(metadata: ImportedSnapshotMetadata, sourceKind: string): string {
  const nested = metadata.source_plugin_kind;
  return typeof nested === "string" && nested.length > 0 ? nested : sourceKind;
}

export function pluginFormatLabelForName(pluginName: string, origin: PluginOrigin): string {
  const snapshot = getLatestImportedSnapshot(pluginName);
  if (!snapshot) return pluginFormatLabel(undefined, origin);
  return pluginFormatLabel(kindFromMetadata(snapshot.metadata, snapshot.source_kind), origin);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function skippedList(value: unknown): PluginImportDiagnostics["skipped"] {
  if (!Array.isArray(value)) return [];
  const skipped: PluginImportDiagnostics["skipped"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.component !== "string" || typeof record.name !== "string") continue;
    if (typeof record.reason !== "string") continue;
    skipped.push({ component: record.component, name: record.name, reason: record.reason });
  }
  return skipped;
}

function reportedList(value: unknown): PluginImportDiagnostics["reported"] {
  if (!Array.isArray(value)) return [];
  const reported: PluginImportDiagnostics["reported"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.field !== "string" || typeof record.message !== "string") continue;
    reported.push({ field: record.field, message: record.message });
  }
  return reported;
}

export function diagnosticsFromMetadata(
  metadata: ImportedSnapshotMetadata,
): PluginImportDiagnostics | undefined {
  const spec = metadata.spec_load;
  const legacy = stringList(metadata.legacy_warnings);
  if (!spec || typeof spec !== "object") {
    if (legacy.length === 0) return undefined;
    return { ok: true, skipped: [], reported: [], legacy_warnings: legacy };
  }
  const record = spec as Record<string, unknown>;
  const mcpDisabled = typeof record.mcpDisabled === "string" ? record.mcpDisabled : undefined;
  return {
    ok: record.ok !== false,
    skipped: skippedList(record.skipped),
    reported: reportedList(record.reported),
    legacy_warnings: legacy,
    ...(mcpDisabled ? { mcp_disabled: mcpDisabled } : {}),
  };
}

export function readPluginImportDiagnostics(
  pluginName: string,
): PluginImportDiagnostics | undefined {
  const snapshot = getLatestImportedSnapshot(pluginName);
  if (!snapshot) return undefined;
  return diagnosticsFromMetadata(snapshot.metadata);
}

export function importNoteLines(diagnostics: PluginImportDiagnostics | undefined): string[] {
  if (!diagnostics) return [];
  const lines = [...diagnostics.legacy_warnings];
  for (const reported of diagnostics.reported) lines.push(reported.message);
  for (const skipped of diagnostics.skipped) {
    lines.push(`${skipped.component} ${skipped.name}: ${skipped.reason}`);
  }
  if (diagnostics.mcp_disabled) {
    lines.push(`MCP was not loaded: ${diagnostics.mcp_disabled}`);
  }
  return lines;
}
