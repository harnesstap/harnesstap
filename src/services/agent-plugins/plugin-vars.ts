import type { McpServerMetadata } from "../../types.js";

/**
 * Where a spec placeholder is rewritten. Cursor expands only its own root
 * variable. Claude expands both. Other harnesses get absolute paths.
 */
export type PluginVarTarget = "cursor" | "claude-code" | "absolute";

export interface PluginVarContext {
  /** Absolute plugin install root. */
  root: string;
  /** Absolute PLUGIN_DATA directory. */
  dataDir: string;
}

const EXACT_PLACEHOLDER = /\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g;

function replacement(
  name: "PLUGIN_ROOT" | "PLUGIN_DATA",
  target: PluginVarTarget,
  context: PluginVarContext,
): string {
  if (name === "PLUGIN_ROOT") {
    switch (target) {
      case "cursor":
        return "${CURSOR_PLUGIN_ROOT}";
      case "claude-code":
        return "${CLAUDE_PLUGIN_ROOT}";
      case "absolute":
        return context.root;
      default: {
        const unreachable: never = target;
        return unreachable;
      }
    }
  }
  switch (target) {
    case "cursor":
    case "absolute":
      return context.dataDir;
    case "claude-code":
      return "${CLAUDE_PLUGIN_DATA}";
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}

/**
 * Replace exact `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` tokens once.
 * `${PLUGIN_ROOT_SUFFIX}`, `${APC_UNKNOWN}` and `$APC_VALUE` stay literal.
 * The replacement text is not scanned again.
 */
export function translatePluginVars(
  value: string,
  target: PluginVarTarget,
  context: PluginVarContext,
): string {
  return value.replace(EXACT_PLACEHOLDER, (match, name: string) => {
    if (name !== "PLUGIN_ROOT" && name !== "PLUGIN_DATA") return match;
    return replacement(name, target, context);
  });
}

function translateRecord(
  record: Record<string, string> | undefined,
  target: PluginVarTarget,
  context: PluginVarContext,
): Record<string, string> | undefined {
  if (!record) return record;
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key] = translatePluginVars(value, target, context);
  }
  return next;
}

/** Copy of MCP metadata with plugin variables translated. The library copy is unchanged. */
export function translateMcpMetadata(
  metadata: McpServerMetadata,
  target: PluginVarTarget,
  context: PluginVarContext,
): McpServerMetadata {
  return {
    ...metadata,
    ...(metadata.command !== undefined
      ? { command: translatePluginVars(metadata.command, target, context) }
      : {}),
    ...(metadata.url !== undefined
      ? { url: translatePluginVars(metadata.url, target, context) }
      : {}),
    ...(metadata.cwd !== undefined
      ? { cwd: translatePluginVars(metadata.cwd, target, context) }
      : {}),
    ...(metadata.args
      ? { args: metadata.args.map((arg) => translatePluginVars(arg, target, context)) }
      : {}),
    ...(metadata.env ? { env: translateRecord(metadata.env, target, context) } : {}),
    ...(metadata.headers ? { headers: translateRecord(metadata.headers, target, context) } : {}),
  };
}

/** Harnesses whose MCP config has a working-directory field. */
const CWD_WRITTEN_FOR = new Set([
  "claude-code",
  "codex",
  "copilot-cli",
  "github-copilot",
  "grok-build",
]);

/** Warnings for spec fields the harness serializer does not write. */
export function mcpSerializationWarnings(
  serverName: string,
  metadata: McpServerMetadata,
  platformId: string,
): string[] {
  const warnings: string[] = [];
  if (metadata.cwd && !CWD_WRITTEN_FOR.has(platformId)) {
    warnings.push(
      `MCP server "${serverName}": cwd is not written for ${platformId}. The server may start in the wrong directory.`,
    );
  }
  if (metadata.http_transport === "sse" || metadata.connection_type === "sse") {
    warnings.push(
      `MCP server "${serverName}": sse is written as the harness HTTP transport. Clients that need an explicit sse type should load the Agent Plugins package.`,
    );
  }
  return warnings;
}
