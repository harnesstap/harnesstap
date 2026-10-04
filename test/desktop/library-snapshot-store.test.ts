import { describe, expect, it } from "bun:test";
import {
  LIBRARY_INVENTORY_PEEK_LIMIT,
  type LibraryInventoryResult,
} from "../../apps/desktop/src/lib/api/library-inventory.ts";
import type { LibraryListEntry } from "../../apps/desktop/src/lib/library-list.ts";
import {
  createLibrarySnapshotStore,
  visibleLibraryRows,
  type LibrarySnapshotFetchers,
} from "../../apps/desktop/src/state/library-snapshot-store.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function entry(name: string, type = "skill"): LibraryListEntry {
  return {
    listKind: "resource",
    id: name,
    name,
    type,
    namespace: null,
    description: null,
    originOutdated: false,
  };
}

function inventory(
  rows: LibraryListEntry[],
  type_counts: Record<string, number> = { skill: rows.length },
): LibraryInventoryResult {
  return {
    rows,
    total: rows.length,
    type_counts,
    offset: 0,
  };
}

const unused: LibrarySnapshotFetchers["fetchInventory"] = () =>
  Promise.reject(new Error("not used in this test"));

function storeWith(
  fetchInventory: LibrarySnapshotFetchers["fetchInventory"] = unused,
) {
  const store = createLibrarySnapshotStore({ fetchInventory });
  store.setClient({ baseUrl: "http://127.0.0.1:7474", token: "t" });
  return store;
}

describe("library snapshot store", () => {
  it("loadPeek requests limit 40 and empty q", async () => {
    const calls: Array<Parameters<LibrarySnapshotFetchers["fetchInventory"]>> = [];
    const store = storeWith(async (baseUrl, token, input) => {
      calls.push([baseUrl, token, input]);
      return inventory([entry("peek-skill")]);
    });

    await store.loadPeek();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("http://127.0.0.1:7474");
    expect(calls[0]?.[1]).toBe("t");
    expect(calls[0]?.[2]).toEqual({
      limit: LIBRARY_INVENTORY_PEEK_LIMIT,
      q: "",
    });
    expect(LIBRARY_INVENTORY_PEEK_LIMIT).toBe(40);
    expect(store.getState().peek).toEqual([entry("peek-skill")]);
    expect(store.getState().status).toBe("idle");
  });

  it("loadFull does not clear peek and omits a limit", async () => {
    const peekRows = [entry("peek-skill")];
    const fullRows = [entry("a"), entry("b")];
    const store = storeWith(async (_baseUrl, _token, input) => {
      if (input?.limit !== undefined) {
        return inventory(peekRows, { skill: 2 });
      }
      return inventory(fullRows, { skill: 2 });
    });

    await store.loadPeek();
    expect(store.getState().peek).toEqual(peekRows);

    await store.loadFull();
    expect(store.getState().peek).toEqual(peekRows);
    expect(store.getState().full).toEqual(fullRows);
    expect(store.getState().typeCounts).toEqual({ skill: 2 });
  });

  it("keeps peek visible while loadFull is in flight", async () => {
    const peekRows = [entry("peek-skill")];
    const full = deferred<LibraryInventoryResult>();
    const store = storeWith(async (_baseUrl, _token, input) => {
      if (input?.limit !== undefined) {
        return inventory(peekRows, { skill: 1 });
      }
      return full.promise;
    });

    await store.loadPeek();
    const pending = store.loadFull();
    const state = store.getState();
    expect(state.peek).toEqual(peekRows);
    expect(state.full).toBeNull();
    expect(["refreshing", "loading-full"]).toContain(state.status);
    expect(visibleLibraryRows(state)).toEqual(peekRows);

    full.resolve(inventory([entry("full-skill")], { skill: 1 }));
    await pending;
    expect(visibleLibraryRows(store.getState())).toEqual([entry("full-skill")]);
    expect(store.getState().status).toBe("idle");
  });

  it("search fetches with q and does not client-filter peek", async () => {
    const peekRows = [entry("alpha"), entry("beta")];
    const searchRows = [entry("ship")];
    const calls: Array<Parameters<LibrarySnapshotFetchers["fetchInventory"]>[2]> = [];
    const store = storeWith(async (_baseUrl, _token, input) => {
      calls.push(input);
      if (input?.q) {
        return inventory(searchRows, { skill: 1 });
      }
      return inventory(peekRows, { skill: 2 });
    });

    await store.loadPeek();
    await store.search({ q: "ship", type: "skill" });

    expect(calls.at(-1)).toEqual({ q: "ship", type: "skill" });
    expect(store.getState().peek).toEqual(peekRows);
    expect(store.getState().searchRows).toEqual(searchRows);
    expect(store.getState().searchQuery).toBe("ship");
    expect(store.getState().searchType).toBe("skill");
    expect(store.getState().searchTypeCounts).toEqual({ skill: 1 });
  });

  it("empty q search clears searchRows without fetching", async () => {
    let fetches = 0;
    const store = storeWith(async (_baseUrl, _token, input) => {
      fetches += 1;
      if (input?.q) {
        return inventory([entry("ship")]);
      }
      return inventory([entry("peek")]);
    });

    await store.search({ q: "ship", type: null });
    expect(store.getState().searchRows).toEqual([entry("ship")]);
    const before = fetches;

    await store.search({ q: "", type: null });
    expect(fetches).toBe(before);
    expect(store.getState().searchQuery).toBe("");
    expect(store.getState().searchRows).toBeNull();
    expect(store.getState().searchTypeCounts).toBeNull();
  });

  it("drops a stale peek response after generation advances", async () => {
    const first = deferred<LibraryInventoryResult>();
    const second = deferred<LibraryInventoryResult>();
    const calls: Deferred<LibraryInventoryResult>[] = [first, second];
    const store = storeWith(() => calls.shift()?.promise ?? unused());

    const firstRequest = store.loadPeek();
    store.invalidate();
    second.resolve(inventory([entry("fresh")]));
    await second.promise;
    await Promise.resolve();

    first.resolve(inventory([entry("stale")]));
    await firstRequest;

    expect(store.getState().peek).toEqual([entry("fresh")]);
    expect(store.getState().generation).toBeGreaterThan(0);
  });

  it("does not mark idle when a dropped peek resolves after clear starts a new load", async () => {
    const first = deferred<LibraryInventoryResult>();
    const second = deferred<LibraryInventoryResult>();
    const calls: Deferred<LibraryInventoryResult>[] = [first, second];
    const store = storeWith(() => calls.shift()?.promise ?? unused());

    const firstRequest = store.loadPeek();
    expect(store.getState().status).toBe("loading-peek");

    store.clear();
    const secondRequest = store.loadPeek();
    expect(store.getState().status).toBe("loading-peek");

    first.resolve(inventory([entry("stale")]));
    await firstRequest;

    expect(store.getState().status).toBe("loading-peek");
    expect(store.getState().peek).toBeNull();

    second.resolve(inventory([entry("fresh")]));
    await secondRequest;
    expect(store.getState().status).toBe("idle");
    expect(store.getState().peek).toEqual([entry("fresh")]);
  });

  it("clear empties peek and full", async () => {
    const store = storeWith(async (_baseUrl, _token, input) => {
      if (input?.limit !== undefined) {
        return inventory([entry("peek")]);
      }
      return inventory([entry("full")]);
    });

    await store.loadPeek();
    await store.loadFull();
    store.clear();

    expect(store.getState().peek).toBeNull();
    expect(store.getState().full).toBeNull();
    expect(visibleLibraryRows(store.getState())).toEqual([]);
  });

  it("invalidate reloads peek, full when previously loaded, and active search", async () => {
    const calls: Array<Parameters<LibrarySnapshotFetchers["fetchInventory"]>[2]> = [];
    const store = storeWith(async (_baseUrl, _token, input) => {
      calls.push(input);
      if (input?.q) {
        return inventory([entry("hit")]);
      }
      if (input?.limit !== undefined) {
        return inventory([entry("peek")]);
      }
      return inventory([entry("full")]);
    });

    await store.loadPeek();
    await store.loadFull();
    await store.search({ q: "hit", type: null });
    const generation = store.getState().generation;
    calls.length = 0;

    await store.invalidate();

    expect(store.getState().generation).toBeGreaterThan(generation);
    expect(calls.some((input) => input?.limit === LIBRARY_INVENTORY_PEEK_LIMIT && input.q === "")).toBe(
      true,
    );
    expect(calls.some((input) => input?.limit === undefined && !input?.q)).toBe(true);
    expect(calls.some((input) => input?.q === "hit")).toBe(true);
  });

  it("returns to idle after overlapping loadFull requests both settle", async () => {
    const first = deferred<LibraryInventoryResult>();
    const second = deferred<LibraryInventoryResult>();
    const calls: Deferred<LibraryInventoryResult>[] = [first, second];
    const store = storeWith(() => calls.shift()?.promise ?? unused());

    const firstRequest = store.loadFull();
    const secondRequest = store.loadFull();
    expect(store.getState().status).toBe("loading-full");

    first.resolve(inventory([entry("stale-full")]));
    await firstRequest;
    expect(store.getState().full).toBeNull();
    expect(store.getState().status).toBe("loading-full");

    second.resolve(inventory([entry("fresh-full")]));
    await secondRequest;
    expect(store.getState().full).toEqual([entry("fresh-full")]);
    expect(store.getState().status).toBe("idle");
  });

  it("returns to idle when invalidate overlaps an in-flight loadFull", async () => {
    const overlapping = deferred<LibraryInventoryResult>();
    const peekAfter = deferred<LibraryInventoryResult>();
    const fullAfter = deferred<LibraryInventoryResult>();
    let peekLoads = 0;
    let fullLoads = 0;
    const store = storeWith((_baseUrl, _token, input) => {
      if (input?.limit !== undefined) {
        peekLoads += 1;
        if (peekLoads === 1) {
          return inventory([entry("peek")], { skill: 1 });
        }
        return peekAfter.promise;
      }
      fullLoads += 1;
      if (fullLoads === 1) {
        return inventory([entry("full")], { skill: 1 });
      }
      if (fullLoads === 2) {
        return overlapping.promise;
      }
      return fullAfter.promise;
    });

    await store.loadPeek();
    await store.loadFull();
    const refreshing = store.loadFull();
    expect(store.getState().status).toBe("refreshing");

    const invalidating = store.invalidate();
    overlapping.resolve(inventory([entry("stale-full")], { skill: 1 }));
    await refreshing;

    peekAfter.resolve(inventory([entry("peek-2")], { skill: 1 }));
    fullAfter.resolve(inventory([entry("full-2")], { skill: 1 }));
    await invalidating;

    expect(store.getState().peek).toEqual([entry("peek-2")]);
    expect(store.getState().full).toEqual([entry("full-2")]);
    expect(store.getState().status).toBe("idle");
  });

  it("does not fetch until a client is set", async () => {
    let fetches = 0;
    const store = createLibrarySnapshotStore({
      fetchInventory: async () => {
        fetches += 1;
        return inventory([entry("x")]);
      },
    });

    await store.loadPeek();
    await store.loadFull();
    await store.search({ q: "x", type: null });
    expect(fetches).toBe(0);
  });
});
