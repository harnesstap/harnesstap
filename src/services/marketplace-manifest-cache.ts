import { readFileSync, statSync } from "node:fs";

const MAX_ENTRIES = 200;

const cache = new Map<string, { sig: string; value: unknown }>();

export function clearMarketplaceManifestCache(): void {
  cache.clear();
}

function fileSignature(path: string): string | null {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

/**
 * Parsed marketplace JSON. Reused until the file mtime or size changes.
 * Parse failures are not cached. Callers receive a clone.
 */
export function readCachedMarketplaceJson(path: string): unknown | undefined {
  const sig = fileSignature(path);
  if (!sig) return undefined;
  const cached = cache.get(path);
  if (cached && cached.sig === sig) {
    return structuredClone(cached.value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  cache.set(path, { sig, value: parsed });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return structuredClone(parsed);
}
