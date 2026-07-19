import { mkdtempSync, writeFileSync } from "node:fs";
import { fetchWithTimeout } from "./transport/fetch-with-timeout.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_PATTERN = /^https?:\/\//i;

export function isLayerUrl(source: string): boolean {
  return URL_PATTERN.test(source);
}

export function isLayerExportFilePath(source: string): boolean {
  return source.endsWith(".toml") || source.endsWith(".harnesstap.toml");
}

export function writeLayerExportToTempFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harnesstap-layer-export-"));
  const filePath = join(dir, "remote.harnesstap.toml");
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}

/**
 * Fetch a remote layer export and return a local temp file path.
 */
export async function fetchLayerExportToTempFile(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, { timeoutMs: 60_000 });
  if (!response.ok) {
    throw new Error(`Failed to fetch layer export (${response.status}): ${url}`);
  }
  const body = await response.text();
  return writeLayerExportToTempFile(body);
}
