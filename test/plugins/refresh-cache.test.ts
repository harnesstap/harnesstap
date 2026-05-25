import { describe, it, expect } from "bun:test";
import {
  isSourceStale,
  markSourceRefreshed,
  getSourcesToRefresh,
  type RefreshCacheFile,
} from "../../src/plugins/refresh-cache.js";

describe("refresh-cache", () => {
  it("treats missing entry as stale", () => {
    const cache: RefreshCacheFile = { sources: {} };
    expect(isSourceStale(cache, "claude:foo", 24)).toBe(true);
  });

  it("returns not stale within max age", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const cache = markSourceRefreshed({ sources: {} }, "claude:foo", now);
    expect(isSourceStale(cache, "claude:foo", 24, now)).toBe(false);
  });

  it("returns stale after max age", () => {
    const refreshed = new Date("2026-05-17T12:00:00.000Z");
    const now = new Date("2026-05-19T12:00:00.000Z");
    const cache = markSourceRefreshed({ sources: {} }, "claude:foo", refreshed);
    expect(isSourceStale(cache, "claude:foo", 24, now)).toBe(true);
  });

  it("getSourcesToRefresh returns all keys when forceRefresh", () => {
    const cache = markSourceRefreshed({ sources: {} }, "a", new Date());
    const keys = ["a", "b"];
    expect(getSourcesToRefresh(keys, cache, 24, true)).toEqual(["a", "b"]);
  });

  it("getSourcesToRefresh returns only stale keys", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const cache = markSourceRefreshed({ sources: {} }, "fresh", now);
    expect(getSourcesToRefresh(["fresh", "stale"], cache, 24, false, now)).toEqual([
      "stale",
    ]);
  });
});
