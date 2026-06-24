import { describe, expect, it } from "bun:test";
import { createDebouncedRemoteSearchRunner } from "../../src/services/wizards/prompts/hooks/use-debounced-remote-search.ts";

describe("createDebouncedRemoteSearchRunner", () => {
  it("ignores stale responses when a newer search completes first", async () => {
    let currentItems: string[] = [];
    let resolveFirst: (value: string[]) => void;
    let resolveSecond: (value: string[]) => void;
    let callIndex = 0;

    const runner = createDebouncedRemoteSearchRunner({
      limitFor: () => 10,
      searchFn: async () => {
        callIndex += 1;
        if (callIndex === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      },
      setItems: (items) => {
        currentItems = items;
      },
      setLoading: () => undefined,
      setError: () => undefined,
    });

    const first = runner.runSearch("slow");
    const second = runner.runSearch("fast");

    resolveSecond?.(["fast-result"]);
    await second;

    resolveFirst?.(["stale-result"]);
    await first;

    expect(currentItems).toEqual(["fast-result"]);
  });

  it("stores search errors from the latest request only", async () => {
    let currentError: string | null = null;
    let resolveFirst: (value: string[]) => void;
    let resolveSecond: (value: string[]) => void;
    let callIndex = 0;

    const runner = createDebouncedRemoteSearchRunner({
      limitFor: () => 10,
      searchFn: async () => {
        callIndex += 1;
        if (callIndex === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Promise((_, reject) => {
          resolveSecond = () => reject(new Error("search failed"));
        });
      },
      setItems: () => undefined,
      setLoading: () => undefined,
      setError: (error) => {
        currentError = error;
      },
    });

    const first = runner.runSearch("slow");
    const second = runner.runSearch("fast");

    resolveSecond?.();
    await second;

    resolveFirst?.(["stale-result"]);
    await first;

    expect(currentError).toBe("search failed");
  });
});
