import { mkdtempSync, writeFileSync } from "node:fs";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApEnvelopePath } from "./agent-plugins/envelope.js";

const URL_PATTERN = /^https?:\/\//i;

export function isPluginUrl(source: string): boolean {
  return URL_PATTERN.test(source);
}

export function isPluginExportFilePath(source: string): boolean {
  return isApEnvelopePath(source) || source.endsWith("/plugin.json");
}

export function writePluginExportToTempFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harnesstap-plugin-export-"));
  const filePath = join(dir, "remote.ap.json");
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}

/**
 * Fetch a remote plugin package and return a local temp file path.
 */
export async function fetchPluginExportToTempFile(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, { timeoutMs: 60_000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin export (${response.status}): ${url}`);
  }
  const body = await response.text();
  return writePluginExportToTempFile(body);
}
