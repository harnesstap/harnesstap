export const TRACKED_DIRS_INTRO_STORAGE_KEY = "ht.desktop.trackedDirsIntroSeen";

export function hasSeenTrackedDirsIntro(
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): boolean {
  if (!storage) {
    return false;
  }
  try {
    return storage.getItem(TRACKED_DIRS_INTRO_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTrackedDirsIntroSeen(
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(TRACKED_DIRS_INTRO_STORAGE_KEY, "1");
  } catch {
    // Quota or privacy mode: first-run still opens once this session.
  }
}
