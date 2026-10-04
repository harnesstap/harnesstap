import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  fetchLibraryInventory,
  LIBRARY_INVENTORY_PEEK_LIMIT,
  type LibraryInventoryResult,
} from "../lib/api/library-inventory";
import type { LibraryListEntry } from "../lib/library-list";
import type { AgentClient } from "./agent-session";

export type LibrarySnapshotStatus = "idle" | "loading-peek" | "loading-full" | "refreshing";

export interface LibrarySnapshotStoreState {
  generation: number;
  peek: LibraryListEntry[] | null;
  full: LibraryListEntry[] | null;
  typeCounts: Record<string, number>;
  searchQuery: string;
  searchType: string | null;
  searchRows: LibraryListEntry[] | null;
  searchTypeCounts: Record<string, number> | null;
  status: LibrarySnapshotStatus;
  error: string | null;
  searchError: string | null;
}

export const initialLibrarySnapshotState: LibrarySnapshotStoreState = {
  generation: 0,
  peek: null,
  full: null,
  typeCounts: {},
  searchQuery: "",
  searchType: null,
  searchRows: null,
  searchTypeCounts: null,
  status: "idle",
  error: null,
  searchError: null,
};

export interface LibrarySnapshotFetchers {
  fetchInventory: (
    baseUrl: string,
    token: string | null,
    input?: {
      limit?: number;
      offset?: number;
      q?: string;
      type?: string | null;
      signal?: AbortSignal;
    },
  ) => Promise<LibraryInventoryResult>;
}

const defaultFetchers: LibrarySnapshotFetchers = {
  fetchInventory: fetchLibraryInventory,
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Visible library rows: prefer a completed full snapshot, else peek. */
export function visibleLibraryRows(state: LibrarySnapshotStoreState): LibraryListEntry[] {
  return state.full ?? state.peek ?? [];
}

export interface LibrarySearchInput {
  q: string;
  type: string | null;
  signal?: AbortSignal;
}

export interface LibrarySnapshotStore {
  getState: () => LibrarySnapshotStoreState;
  subscribe: (listener: () => void) => () => void;
  setClient: (client: AgentClient | null) => void;
  clear: () => void;
  loadPeek: () => Promise<void>;
  loadFull: () => Promise<void>;
  search: (input: LibrarySearchInput) => Promise<void>;
  invalidate: () => Promise<void>;
}

export function createLibrarySnapshotStore(
  fetchers: LibrarySnapshotFetchers = defaultFetchers,
): LibrarySnapshotStore {
  let state = initialLibrarySnapshotState;
  let client: AgentClient | null = null;
  const listeners = new Set<() => void>();
  let peekGeneration = 0;
  let fullGeneration = 0;
  let searchGeneration = 0;
  let peekInFlight = 0;
  let fullInFlight = 0;

  const setState = (patch: Partial<LibrarySnapshotStoreState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  };

  const settleStatus = (): LibrarySnapshotStatus => {
    const peekVisible = (state.peek?.length ?? 0) > 0;
    const fullHeld = state.full !== null;
    if (fullInFlight > 0) {
      return peekVisible || fullHeld ? "refreshing" : "loading-full";
    }
    if (peekInFlight > 0) {
      return state.peek !== null ? "refreshing" : "loading-peek";
    }
    return "idle";
  };

  const isCurrent = (
    kind: "peek" | "full" | "search",
    requestGeneration: number,
    snapshotGeneration: number,
  ): boolean => {
    if (state.generation !== snapshotGeneration) {
      return false;
    }
    switch (kind) {
      case "peek":
        return peekGeneration === requestGeneration;
      case "full":
        return fullGeneration === requestGeneration;
      case "search":
        return searchGeneration === requestGeneration;
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  };

  const loadPeek = async (): Promise<void> => {
    if (!client) {
      return;
    }
    const requestGeneration = ++peekGeneration;
    const snapshotGeneration = state.generation;
    peekInFlight += 1;
    setState({
      status: state.peek !== null ? "refreshing" : "loading-peek",
      error: null,
    });
    try {
      const result = await fetchers.fetchInventory(client.baseUrl, client.token, {
        limit: LIBRARY_INVENTORY_PEEK_LIMIT,
        q: "",
      });
      if (!isCurrent("peek", requestGeneration, snapshotGeneration)) {
        return;
      }
      setState({
        peek: result.rows,
        typeCounts: state.full === null ? result.type_counts : state.typeCounts,
        error: null,
      });
    } catch (error) {
      if (!isCurrent("peek", requestGeneration, snapshotGeneration) || isAbortError(error)) {
        return;
      }
      setState({
        error: errorMessage(error, "Could not load library inventory"),
      });
    } finally {
      peekInFlight = Math.max(0, peekInFlight - 1);
      if (isCurrent("peek", requestGeneration, snapshotGeneration)) {
        setState({ status: settleStatus() });
      }
    }
  };

  const loadFull = async (): Promise<void> => {
    if (!client) {
      return;
    }
    const requestGeneration = ++fullGeneration;
    const snapshotGeneration = state.generation;
    const peekVisible = (state.peek?.length ?? 0) > 0;
    fullInFlight += 1;
    setState({
      status: peekVisible || state.full !== null ? "refreshing" : "loading-full",
      error: null,
    });
    try {
      const result = await fetchers.fetchInventory(client.baseUrl, client.token, {});
      if (!isCurrent("full", requestGeneration, snapshotGeneration)) {
        return;
      }
      setState({
        full: result.rows,
        typeCounts: result.type_counts,
        error: null,
      });
    } catch (error) {
      if (!isCurrent("full", requestGeneration, snapshotGeneration) || isAbortError(error)) {
        return;
      }
      setState({
        error: errorMessage(error, "Could not load library inventory"),
      });
    } finally {
      fullInFlight = Math.max(0, fullInFlight - 1);
      if (isCurrent("full", requestGeneration, snapshotGeneration)) {
        setState({ status: settleStatus() });
      }
    }
  };

  const search = async (input: LibrarySearchInput): Promise<void> => {
    const q = input.q.trim();
    if (!q) {
      searchGeneration += 1;
      setState({
        searchQuery: "",
        searchRows: null,
        searchTypeCounts: null,
        searchError: null,
      });
      return;
    }
    if (!client) {
      return;
    }
    const requestGeneration = ++searchGeneration;
    const snapshotGeneration = state.generation;
    setState({
      searchQuery: q,
      searchType: input.type,
      searchError: null,
    });
    try {
      const result = await fetchers.fetchInventory(client.baseUrl, client.token, {
        q,
        type: input.type,
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!isCurrent("search", requestGeneration, snapshotGeneration)) {
        return;
      }
      setState({
        searchRows: result.rows,
        searchTypeCounts: result.type_counts,
        searchError: null,
      });
    } catch (error) {
      if (!isCurrent("search", requestGeneration, snapshotGeneration) || isAbortError(error)) {
        return;
      }
      setState({
        searchError: errorMessage(error, "Could not search library inventory"),
      });
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setClient: (next) => {
      client = next;
    },
    clear: () => {
      peekGeneration += 1;
      fullGeneration += 1;
      searchGeneration += 1;
      setState({
        ...initialLibrarySnapshotState,
        generation: state.generation + 1,
      });
    },
    loadPeek,
    loadFull,
    search,
    async invalidate() {
      const hadFull = state.full !== null;
      const q = state.searchQuery;
      const type = state.searchType;
      peekGeneration += 1;
      fullGeneration += 1;
      searchGeneration += 1;
      setState({ generation: state.generation + 1 });
      if (!client) {
        return;
      }
      const tasks: Promise<void>[] = [loadPeek()];
      if (hadFull) {
        tasks.push(loadFull());
      }
      if (q) {
        tasks.push(search({ q, type }));
      }
      await Promise.all(tasks);
    },
  };
}

export const librarySnapshotStore: LibrarySnapshotStore = createLibrarySnapshotStore();

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (
    typeof a !== "object"
    || typeof b !== "object"
    || a === null
    || b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  const recordB = b as Record<string, unknown>;
  return keysA.every((key) =>
    Object.prototype.hasOwnProperty.call(recordB, key)
    && Object.is((a as Record<string, unknown>)[key], recordB[key]),
  );
}

export function useLibrarySnapshotStore<T>(
  selector: (state: LibrarySnapshotStoreState) => T,
  store: LibrarySnapshotStore = librarySnapshotStore,
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef<{ state: LibrarySnapshotStoreState; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const nextState = store.getState();
    const cached = cacheRef.current;
    if (cached && cached.state === nextState) {
      return cached.value;
    }
    const next = selectorRef.current(nextState);
    if (cached && shallowEqual(cached.value, next)) {
      cacheRef.current = { state: nextState, value: cached.value };
      return cached.value;
    }
    cacheRef.current = { state: nextState, value: next };
    return next;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
