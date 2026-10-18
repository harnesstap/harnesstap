import { useSyncExternalStore } from "react";

/**
 * Updates the user already saw in the bell, keyed `plugin@version`. Reading
 * the notification clears the rail badge for that version; a newer version
 * shows the badge again. Kept in localStorage so it survives a restart.
 */
const STORAGE_KEY = "harnesstap.updates.seen";
const MAX_KEYS = 500;

let seen: ReadonlySet<string> = load();
const listeners = new Set<() => void>();

function load(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

export function seenUpdateKey(plugin: string, version: string): string {
  return `${plugin}@${version}`;
}

export function markUpdatesSeen(keys: readonly string[]): void {
  const fresh = keys.filter((key) => !seen.has(key));
  if (fresh.length === 0) return;
  seen = new Set([...seen, ...fresh].slice(-MAX_KEYS));
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Storage full or unavailable: the badge just comes back after a restart.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSeenUpdates(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => seen, () => seen);
}
