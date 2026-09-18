import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  fetchApplyPreview,
  fetchProfiles,
  fetchProfileStash,
  fetchStatus,
} from "../lib/agent-client";
import { scopeToView, type Scope } from "../lib/api/scope";
import { mergeStatusUpdate } from "../lib/status-merge";
import type {
  GlobalProfileStatus,
  GlobalProfileStatusDepth,
  ProfileApplyPreview,
  ProfileApplyPreviewRequest,
  ProfileStashEntry,
  ProfileStashListResult,
  ProfileSummary,
} from "../lib/types";
import type { AgentClient } from "./agent-session";

export const POLL_MS = 2000;
export const ACTIVITY_TTL_MS = 60_000;

export interface PreviewKey {
  scope: Scope;
  projectPath: string | null;
  profile: string;
}

export function previewKeyId(key: PreviewKey): string {
  return `${key.scope}\u0000${key.projectPath ?? ""}\u0000${key.profile}`;
}

export interface PreviewEntry {
  data: ProfileApplyPreview | null;
  error: string | null;
  refreshing: boolean;
}

export const EMPTY_PREVIEW: PreviewEntry = {
  data: null,
  error: null,
  refreshing: false,
};

export interface StatusStoreState {
  status: GlobalProfileStatus | null;
  statusError: string | null;
  statusRefreshing: boolean;
  /** A `full` status has been merged for the current agent connection. */
  harnessSnapshotComplete: boolean;
  profiles: ProfileSummary[];
  profilesError: string | null;
  profilesRefreshing: boolean;
  stash: ProfileStashEntry[];
  previews: Record<string, PreviewEntry>;
}

export const initialStatusStoreState: StatusStoreState = {
  status: null,
  statusError: null,
  statusRefreshing: false,
  harnessSnapshotComplete: false,
  profiles: [],
  profilesError: null,
  profilesRefreshing: false,
  stash: [],
  previews: {},
};

export interface StatusFetchers {
  fetchStatus: (
    baseUrl: string,
    depth: GlobalProfileStatusDepth,
    projectPath?: string,
    init?: { signal?: AbortSignal },
  ) => Promise<GlobalProfileStatus>;
  fetchProfiles: (
    baseUrl: string,
    projectPath?: string,
    init?: { signal?: AbortSignal },
  ) => Promise<ProfileSummary[]>;
  fetchProfileStash: (
    baseUrl: string,
    token: string | null,
    init?: { signal?: AbortSignal },
  ) => Promise<ProfileStashListResult>;
  fetchApplyPreview: (
    baseUrl: string,
    token: string | null,
    body: ProfileApplyPreviewRequest,
    init?: { signal?: AbortSignal },
  ) => Promise<ProfileApplyPreview>;
}

const defaultFetchers: StatusFetchers = {
  fetchStatus,
  fetchProfiles,
  fetchProfileStash,
  fetchApplyPreview,
};

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export interface StatusStore {
  getState: () => StatusStoreState;
  subscribe: (listener: () => void) => () => void;
  /** Bind the agent connection. A changed `baseUrl` resets the harness snapshot flag. */
  setClient: (client: AgentClient | null) => void;
  getClient: () => AgentClient | null;
  refreshStatus: (
    depth: GlobalProfileStatusDepth,
    projectPath: string,
  ) => Promise<boolean>;
  refreshProfiles: (projectPath: string) => Promise<void>;
  refreshStash: () => Promise<void>;
  /** Fetch a preview while keeping the previous value on screen. */
  loadPreview: (key: PreviewKey) => Promise<ProfileApplyPreview | null>;
  setPreview: (key: PreviewKey, preview: ProfileApplyPreview) => void;
  setPreviewError: (key: PreviewKey, error: string | null) => void;
  setStatusError: (error: string | null) => void;
  /** Abort in-flight requests and invalidate their generations. */
  abortInFlight: () => void;
}

export function createStatusStore(
  fetchers: StatusFetchers = defaultFetchers,
): StatusStore {
  let state = initialStatusStoreState;
  let client: AgentClient | null = null;
  let controller = new AbortController();
  const listeners = new Set<() => void>();
  const generations = new Map<string, number>();

  const setState = (patch: Partial<StatusStoreState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      listener();
    }
  };

  const nextGeneration = (key: string): number => {
    const next = (generations.get(key) ?? 0) + 1;
    generations.set(key, next);
    return next;
  };

  const isCurrent = (key: string, generation: number): boolean =>
    generations.get(key) === generation;

  const patchPreview = (id: string, patch: Partial<PreviewEntry>) => {
    const current = state.previews[id] ?? EMPTY_PREVIEW;
    setState({ previews: { ...state.previews, [id]: { ...current, ...patch } } });
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
      const previousBaseUrl = client?.baseUrl ?? null;
      client = next;
      if ((next?.baseUrl ?? null) !== previousBaseUrl) {
        setState({ harnessSnapshotComplete: false });
      }
    },
    getClient: () => client,
    async refreshStatus(depth, projectPath) {
      if (!client) {
        return false;
      }
      const key = `status:${depth}`;
      const generation = nextGeneration(key);
      const { signal } = controller;
      setState({ statusRefreshing: true });
      try {
        const next = await fetchers.fetchStatus(
          client.baseUrl,
          depth,
          projectPath || undefined,
          { signal },
        );
        if (!isCurrent(key, generation)) {
          return false;
        }
        setState({
          status: mergeStatusUpdate(state.status, next, depth),
          statusError: null,
          statusRefreshing: false,
          ...(depth === "full" ? { harnessSnapshotComplete: true } : {}),
        });
        return true;
      } catch (error) {
        if (!isCurrent(key, generation) || isAbortError(error)) {
          return false;
        }
        setState({
          statusError: errorMessage(error, "Could not read live status"),
          statusRefreshing: false,
        });
        return false;
      }
    },
    async refreshProfiles(projectPath) {
      if (!client) {
        return;
      }
      const key = "profiles";
      const generation = nextGeneration(key);
      const { signal } = controller;
      setState({ profilesRefreshing: true });
      try {
        const next = await fetchers.fetchProfiles(
          client.baseUrl,
          projectPath || undefined,
          { signal },
        );
        if (!isCurrent(key, generation)) {
          return;
        }
        setState({ profiles: next, profilesError: null, profilesRefreshing: false });
      } catch (error) {
        if (!isCurrent(key, generation) || isAbortError(error)) {
          return;
        }
        setState({
          profilesError: errorMessage(error, "Could not list profiles"),
          profilesRefreshing: false,
        });
      }
    },
    async refreshStash() {
      if (!client) {
        return;
      }
      const key = "stash";
      const generation = nextGeneration(key);
      const { signal } = controller;
      try {
        const next = await fetchers.fetchProfileStash(client.baseUrl, client.token, {
          signal,
        });
        if (!isCurrent(key, generation)) {
          return;
        }
        setState({ stash: next.entries });
      } catch (error) {
        if (!isCurrent(key, generation) || isAbortError(error)) {
          return;
        }
        // Stash is best-effort; an unreadable stash reads as empty (matches CLI).
        setState({ stash: [] });
      }
    },
    async loadPreview(previewKey) {
      if (!client) {
        return null;
      }
      const id = previewKeyId(previewKey);
      const key = `preview:${id}`;
      const generation = nextGeneration(key);
      const { signal } = controller;
      patchPreview(id, { refreshing: true, error: null });
      try {
        const preview = await fetchers.fetchApplyPreview(
          client.baseUrl,
          client.token,
          {
            profile: previewKey.profile,
            scope: scopeToView(previewKey.scope),
            ...(previewKey.scope === "project" && previewKey.projectPath
              ? { projectPath: previewKey.projectPath }
              : {}),
          },
          { signal },
        );
        if (!isCurrent(key, generation)) {
          return null;
        }
        patchPreview(id, { data: preview, error: null, refreshing: false });
        return preview;
      } catch (error) {
        if (!isCurrent(key, generation) || isAbortError(error)) {
          return null;
        }
        patchPreview(id, {
          error: errorMessage(error, "Could not preview profile apply"),
          refreshing: false,
        });
        return null;
      }
    },
    setPreview(previewKey, preview) {
      const id = previewKeyId(previewKey);
      // A direct write supersedes any in-flight load for the same key.
      nextGeneration(`preview:${id}`);
      patchPreview(id, { data: preview, error: null, refreshing: false });
    },
    setPreviewError(previewKey, error) {
      patchPreview(previewKeyId(previewKey), { error });
    },
    setStatusError(error) {
      setState({ statusError: error });
    },
    abortInFlight() {
      controller.abort();
      controller = new AbortController();
      for (const key of generations.keys()) {
        nextGeneration(key);
      }
      setState({ statusRefreshing: false, profilesRefreshing: false });
    },
  };
}

export const statusStore: StatusStore = createStatusStore();

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

/**
 * Subscribe to a slice of the status store. The selector may return a fresh
 * object; shallow-equal results keep the previous reference so consumers do
 * not re-render on every poll.
 */
export function useStatusStore<T>(
  selector: (state: StatusStoreState) => T,
  store: StatusStore = statusStore,
): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const cacheRef = useRef<{ state: StatusStoreState; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const cached = cacheRef.current;
    if (cached && cached.state === state) {
      return cached.value;
    }
    const next = selectorRef.current(state);
    if (cached && shallowEqual(cached.value, next)) {
      cacheRef.current = { state, value: cached.value };
      return cached.value;
    }
    cacheRef.current = { state, value: next };
    return next;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Select the preview entry for a key (or the empty entry when there is no key). */
export function selectPreview(
  state: StatusStoreState,
  key: PreviewKey | null,
): PreviewEntry {
  if (!key) {
    return EMPTY_PREVIEW;
  }
  return state.previews[previewKeyId(key)] ?? EMPTY_PREVIEW;
}

/**
 * Activity-gated fast status poll. Runs while `enabled`; skips ticks after a
 * minute without user input. Aborts in-flight requests on unmount.
 */
export function useStatusPolling(input: {
  enabled: boolean;
  projectPath: string;
  store?: StatusStore;
}): void {
  const store = input.store ?? statusStore;
  const lastActivityRef = useRef(Date.now());
  const projectPathRef = useRef(input.projectPath);
  projectPathRef.current = input.projectPath;

  useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ["pointerdown", "keydown", "scroll", "wheel", "touchstart"] as const;
    for (const event of events) {
      document.addEventListener(event, markActivity, { passive: true, capture: true });
    }
    window.addEventListener("focus", markActivity);
    return () => {
      for (const event of events) {
        document.removeEventListener(event, markActivity, { capture: true });
      }
      window.removeEventListener("focus", markActivity);
    };
  }, []);

  useEffect(() => {
    if (!input.enabled) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current < ACTIVITY_TTL_MS) {
        void store.refreshStatus("fast", projectPathRef.current);
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [input.enabled, store]);

  useEffect(() => () => store.abortInFlight(), [store]);
}
