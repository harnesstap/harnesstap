import { useEffect, useRef, useState } from "@inquirer/core";

export type DebouncedRemoteSearchConfig<T> = {
  initialQuery?: string;
  debounceMs?: number;
  limitFor: (query: string) => number;
  searchFn: (query: string, limit: number) => Promise<T[]>;
};

type DebouncedRemoteSearchRunnerState<T> = {
  setItems: (items: T[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

export type DebouncedRemoteSearchRunner = {
  runSearch: (nextQuery: string) => Promise<void>;
  scheduleSearch: (nextQuery: string) => void;
  invalidate: () => void;
};

export function createDebouncedRemoteSearchRunner<T>(
  config: Pick<DebouncedRemoteSearchConfig<T>, "debounceMs" | "limitFor" | "searchFn"> &
    DebouncedRemoteSearchRunnerState<T>,
): DebouncedRemoteSearchRunner {
  const debounceMs = config.debounceMs ?? 300;
  const requestRef = { current: 0 };
  const debounceRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

  async function runSearch(nextQuery: string) {
    const requestId = ++requestRef.current;
    config.setLoading(true);
    config.setError(null);
    try {
      const results = await config.searchFn(nextQuery, config.limitFor(nextQuery));
      if (requestId !== requestRef.current) {
        return;
      }
      config.setItems(results);
    } catch (searchError) {
      if (requestId !== requestRef.current) {
        return;
      }
      config.setItems([]);
      config.setError(searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      if (requestId === requestRef.current) {
        config.setLoading(false);
      }
    }
  }

  function scheduleSearch(nextQuery: string) {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(nextQuery);
    }, debounceMs);
  }

  function invalidate() {
    requestRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }

  return { runSearch, scheduleSearch, invalidate };
}

export function useDebouncedRemoteSearch<T>(config: DebouncedRemoteSearchConfig<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const runnerRef = useRef<DebouncedRemoteSearchRunner | null>(null);
  const limitForRef = useRef(config.limitFor);
  limitForRef.current = config.limitFor;

  if (!runnerRef.current) {
    runnerRef.current = createDebouncedRemoteSearchRunner({
      debounceMs: config.debounceMs,
      limitFor: (query) => limitForRef.current(query),
      searchFn: config.searchFn,
      setItems,
      setLoading,
      setError,
    });
  }

  const { runSearch, scheduleSearch, invalidate } = runnerRef.current;

  useEffect(() => {
    void runSearch(config.initialQuery ?? "");
    return invalidate;
  }, []);

  return { items, loading, error, scheduleSearch };
}
