import { readFileSync, statSync } from "./status-fs.js";

const MAX_ENTRIES = 200;

const cache = new Map<string, { sig: string; value: unknown }>();
const namesCache = new Map<string, { sig: string; names: ReadonlySet<string> }>();
let manifestLoads = 0;

export function clearMarketplaceManifestCache(): void {
  cache.clear();
  namesCache.clear();
}

/** How many marketplace JSON files were parsed. Cache hits are not counted. */
export function readMarketplaceManifestLoadCount(): number {
  return manifestLoads;
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
  manifestLoads += 1;
  cache.set(path, { sig, value: parsed });
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return structuredClone(parsed);
}

/** Plugin names from a marketplace manifest. Reuses the parsed file. Does not clone it. */
export function readCachedMarketplacePluginNames(path: string): ReadonlySet<string> | undefined {
  const sig = fileSignature(path);
  if (!sig) return undefined;
  const cached = namesCache.get(path);
  if (cached && cached.sig === sig) return cached.names;
  const parsed = readCachedMarketplaceJson(path) as { plugins?: unknown } | undefined;
  if (!parsed) return undefined;
  const names = new Set<string>();
  if (Array.isArray(parsed.plugins)) {
    for (const entry of parsed.plugins) {
      if (!entry || typeof entry !== "object") continue;
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string" && name.length > 0) names.add(name);
    }
  }
  namesCache.set(path, { sig, names });
  if (namesCache.size > MAX_ENTRIES) {
    const oldest = namesCache.keys().next().value;
    if (oldest) namesCache.delete(oldest);
  }
  return names;
}
