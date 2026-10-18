import { useSyncExternalStore } from "react";

/**
 * "Not now" answers to the Also use on suggestion. Same semantics as before:
 * kept in memory for this session, keyed by resource type and name. The
 * section line's Dismiss writes here too, so both read one store.
 */
const dismissed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function alsoUseOnKey(resourceName: string, resourceType: string): string {
  return `${resourceType}:${resourceName}`;
}

export function isAlsoUseOnDismissed(resourceName: string, resourceType: string): boolean {
  return dismissed.has(alsoUseOnKey(resourceName, resourceType));
}

export function dismissAlsoUseOn(
  entries: ReadonlyArray<{ name: string; type: string }>,
): void {
  for (const entry of entries) {
    dismissed.add(alsoUseOnKey(entry.name, entry.type));
  }
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller whenever a suggestion is dismissed. */
export function useAlsoUseOnDismissals(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
