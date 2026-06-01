import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_PATTERN = /^https?:\/\//i;

export function isLayerUrl(source: string): boolean {
  return URL_PATTERN.test(source);
}

export function isBundleFilePath(source: string): boolean {
  return (
    source.endsWith(".json") ||
    source.endsWith(".jsonc") ||
    source.endsWith(".harnessdeck.json") ||
    source.endsWith(".harnessdeck.jsonc")
  );
}

export function writeLayerBundleToTempFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harnessdeck-bundle-"));
  const filePath = join(dir, "remote.harnessdeck.jsonc");
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}

/**
 * Fetch a remote layer bundle and return a local temp file path.
 */
export async function fetchLayerBundleToTempFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch layer bundle (${response.status}): ${url}`);
  }
  const body = await response.text();
  return writeLayerBundleToTempFile(body);
}
