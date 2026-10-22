import { isAbsolute, join } from "node:path";
import { readHostPluginViewRecord } from "./package-cache/host-plugin-views.js";

/** The keys of the `installed_plugins.json` record HarnessTap writes, sorted. */
const HARNESSTAP_RECORD_KEYS = ["installPath", "scope", "version"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Absolute folder an `installed_plugins.json` record points at. */
export function claudeRecordInstallPath(homeRoot: string, row: unknown): string | undefined {
  if (!isRecord(row) || typeof row.installPath !== "string") return undefined;
  return isAbsolute(row.installPath)
    ? row.installPath
    : join(homeRoot, ".claude", "plugins", row.installPath);
}

/**
 * True when an `installed_plugins.json` record is the one HarnessTap wrote:
 * exactly `{ scope: "user", installPath, version }`, pointing at a plugin
 * folder HarnessTap created. When Claude Code installs a plugin it also
 * writes `installedAt`, `lastUpdated` and `gitCommitSha`, even into the
 * folder HarnessTap created (`claude plugin install x@<marketplace>` after
 * the marketplace was refreshed), so such a record, and the plugin, are the
 * user's. The marketplace name says nothing about who installed a plugin.
 */
export function isHarnessTapClaudeRecord(homeRoot: string, row: unknown): boolean {
  if (!isRecord(row)) return false;
  const keys = Object.keys(row).sort();
  if (keys.length !== HARNESSTAP_RECORD_KEYS.length
    || keys.some((key, index) => key !== HARNESSTAP_RECORD_KEYS[index])) {
    return false;
  }
  if (row.scope !== "user" || typeof row.version !== "string") return false;
  const path = claudeRecordInstallPath(homeRoot, row);
  return path !== undefined && readHostPluginViewRecord(path)?.created === true;
}
