export const NOT_IN_LIBRARY_STORAGE_KEY = "ht.desktop.discoverNotInLibrary";
export const DEFAULT_NOT_IN_LIBRARY = true;

/** Default ON. Missing or unreadable storage uses the default. */
export function readNotInLibraryPreference(
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): boolean {
  if (!storage) {
    return DEFAULT_NOT_IN_LIBRARY;
  }
  try {
    const raw = storage.getItem(NOT_IN_LIBRARY_STORAGE_KEY);
    if (raw === "0") {
      return false;
    }
    if (raw === "1") {
      return true;
    }
    return DEFAULT_NOT_IN_LIBRARY;
  } catch {
    return DEFAULT_NOT_IN_LIBRARY;
  }
}

export function writeNotInLibraryPreference(
  value: boolean,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(NOT_IN_LIBRARY_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Quota or privacy mode: keep the in-memory choice for this session.
  }
}
