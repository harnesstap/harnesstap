import { mkdtempSync, writeFileSync } from "node:fs";
import { fetchWithTimeout } from "./transport/fetch-with-timeout.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_PATTERN = /^https?:\/\//i;

export function isPluginUrl(source: string): boolean {
  return URL_PATTERN.test(source);
}

export function isPluginExportFilePath(source: string): boolean {
  return source.endsWith(".toml") || source.endsWith(".harnesstap.toml");
}

export function writePluginExportToTempFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harnesstap-plugin-export-"));
  const filePath = join(dir, "remote.harnesstap.toml");
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}

/**
 * Fetch a remote plugin export and return a local temp file path.
 */
export async function fetchPluginExportToTempFile(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, { timeoutMs: 60_000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch plugin export (${response.status}): ${url}`);
  }
  const body = await response.text();
  return writePluginExportToTempFile(body);
}
