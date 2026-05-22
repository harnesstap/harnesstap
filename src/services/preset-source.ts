import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_PATTERN = /^https?:\/\//i;

export function isPresetUrl(source: string): boolean {
  return URL_PATTERN.test(source);
}

export function isBundleFilePath(source: string): boolean {
  return source.endsWith(".json") || source.endsWith(".harnessdeck.json");
}

/**
 * Fetch a remote preset bundle and return a local temp file path.
 */
export async function fetchPresetBundleToTempFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch preset bundle (${response.status}): ${url}`);
  }
  const body = await response.text();
  const dir = mkdtempSync(join(tmpdir(), "harnessdeck-bundle-"));
  const filePath = join(dir, "remote.harnessdeck.json");
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}
