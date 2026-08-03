import { mcpConfigContentsEquivalent } from "./mcp-config-bridge.js";
import { isMcpConfigManagedPath } from "./profile-commit-resource.js";
import { jsonContentsEquivalent } from "../utils/json-equal.js";

/**
 * Drift equivalence for managed files: byte match first, then parsed JSON,
 * then MCP semantic compare for harness serialization noise.
 */
export function fileContentsEquivalentForDrift(
  path: string,
  current: string,
  expected: string,
): boolean {
  if (current === expected) {
    return true;
  }
  if (/\.json$/i.test(path) && jsonContentsEquivalent(current, expected)) {
    return true;
  }
  // Copilot (and similar) emit extra fields (type/tools) that parse as different JSON
  // but map to the same mcp_server metadata.
  if (isMcpConfigManagedPath(path) && mcpConfigContentsEquivalent(current, expected)) {
    return true;
  }
  return false;
}
