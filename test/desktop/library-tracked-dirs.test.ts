import { describe, expect, it } from "bun:test";
import {
  hasSeenTrackedDirsIntro,
  markTrackedDirsIntroSeen,
  TRACKED_DIRS_INTRO_STORAGE_KEY,
} from "../../apps/desktop/src/lib/library-tracked-dirs.ts";

describe("tracked directories intro", () => {
  it("persists ht.desktop.trackedDirsIntroSeen", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    expect(hasSeenTrackedDirsIntro(storage)).toBe(false);
    markTrackedDirsIntroSeen(storage);
    expect(store.get(TRACKED_DIRS_INTRO_STORAGE_KEY)).toBe("1");
    expect(hasSeenTrackedDirsIntro(storage)).toBe(true);
  });
});
