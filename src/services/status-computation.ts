import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<Map<string, unknown>>();

/**
 * Share one Cursor inventory, Claude installed_plugins.json, plugin manifests,
 * and marketplace manifests across every lookup a single status computation
 * makes. Outside a status read, `load` runs every time.
 */
export function runInStatusComputation<T>(fn: () => T): T {
  return storage.run(new Map(), fn);
}

let slotsDisabled = false;

/** Run every lookup uncached, so tests can compare against the shared reads. */
export function setStatusComputationSlotsDisabledForTests(disabled: boolean): void {
  slotsDisabled = disabled;
}

export function computationSlot<T>(key: string, load: () => T): T {
  const store = storage.getStore();
  if (!store || slotsDisabled) return load();
  if (store.has(key)) return store.get(key) as T;
  const value = load();
  store.set(key, value);
  return value;
}
