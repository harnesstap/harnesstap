import { parse as parseToml } from "smol-toml";
import { mcpConfigContentsEquivalent } from "./mcp-config-bridge.js";
import { isMcpConfigManagedPath } from "./profile-commit-resource.js";
import { jsonContentsEquivalent } from "../utils/json-equal.js";

/** Same result as `value.replace(/\r\n/g, "\n").replace(/\n+$/u, "")`, without a regex pass over large files. */
export function normalizeLineEndingsAndTrailingNewlines(value: string): string {
  const unixed = value.includes("\r\n") ? value.replace(/\r\n/g, "\n") : value;
  let end = unixed.length;
  while (end > 0 && unixed.charCodeAt(end - 1) === 10) end -= 1;
  return end === unixed.length ? unixed : unixed.slice(0, end);
}

function trailingNewlineEquivalent(left: string, right: string): boolean {
  return normalizeLineEndingsAndTrailingNewlines(left) === normalizeLineEndingsAndTrailingNewlines(right);
}

// Status recomputes compare the same expected and on-disk text for every
// planned file. Keep the last answer per path; a hit needs both strings to
// be equal to the ones compared before.
const EQUIVALENCE_CACHE_MAX = 8192;
const equivalenceByPath = new Map<string, { current: string; expected: string; equivalent: boolean }>();

export function clearFileEquivalenceCache(): void {
  equivalenceByPath.clear();
}

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
 * Drift and apply-skip equivalence: byte match first, then trailing-newline
 * only, then parsed JSON/TOML, then MCP semantic compare for harness
 * serialization noise (type: stdio, tools).
 */
export function fileContentsEquivalentForDrift(
  path: string,
  current: string,
  expected: string,
): boolean {
  if (current === expected) {
    return true;
  }
  const previous = equivalenceByPath.get(path);
  if (previous && previous.current === current && previous.expected === expected) {
    return previous.equivalent;
  }
  const equivalent = fileContentsEquivalentUncached(path, current, expected);
  equivalenceByPath.delete(path);
  equivalenceByPath.set(path, { current, expected, equivalent });
  if (equivalenceByPath.size > EQUIVALENCE_CACHE_MAX) {
    const oldest = equivalenceByPath.keys().next().value;
    if (oldest !== undefined) equivalenceByPath.delete(oldest);
  }
  return equivalent;
}

function fileContentsEquivalentUncached(
  path: string,
  current: string,
  expected: string,
): boolean {
  if (trailingNewlineEquivalent(current, expected)) {
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
