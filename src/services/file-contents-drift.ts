import { parse as parseToml } from "smol-toml";
import { mcpConfigContentsEquivalent } from "./mcp-config-bridge.js";
import { isMcpConfigManagedPath } from "./profile-commit-resource.js";
import { jsonContentsEquivalent } from "../utils/json-equal.js";

function tomlContentsEquivalent(left: string, right: string): boolean {
  try {
    return jsonContentsEquivalent(
      JSON.stringify(parseToml(left)),
      JSON.stringify(parseToml(right)),
    );
  } catch {
    return false;
  }
}

/**
 * Drift and apply-skip equivalence: byte match first, then parsed JSON/TOML,
 * then MCP semantic compare for harness serialization noise (type: stdio, tools).
 */
export function fileContentsEquivalentForDrift(
  path: string,
  current: string,
  expected: string,
): boolean {
  if (current === expected) {
    return true;
  }
  if (/\.jsonc?$/i.test(path) && jsonContentsEquivalent(current, expected)) {
    return true;
  }
  if (/\.toml$/i.test(path) && tomlContentsEquivalent(current, expected)) {
    return true;
  }
  // Copilot (and similar) emit extra fields (type/tools) that parse as different JSON
  // but map to the same mcp_server metadata.
  if (isMcpConfigManagedPath(path) && mcpConfigContentsEquivalent(current, expected)) {
    return true;
  }
  return false;
}
