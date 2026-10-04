import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(
  join(import.meta.dir, "../../apps/desktop/src/App.tsx"),
  "utf8",
);

function sliceBetween(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start === -1 ? 0 : start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("library and discover prefetch on connect", () => {
  test("imports snapshot stores and prefetches on agent connect", () => {
    expect(appSource).toContain(
      'from "./state/library-snapshot-store"',
    );
    expect(appSource).toContain(
      'from "./state/discover-snapshot-store"',
    );
    expect(appSource).toContain("librarySnapshotStore");
    expect(appSource).toContain("discoverSnapshotStore");

    const connectedEffect = sliceBetween(
      appSource,
      "if (!connected || !client)",
      "useStatusPolling",
    );

    expect(connectedEffect).toContain("librarySnapshotStore.setClient");
    expect(connectedEffect).toContain("client.baseUrl");
    expect(connectedEffect).toContain("client.token");
    expect(connectedEffect).toContain("void librarySnapshotStore.loadPeek()");
    expect(connectedEffect).toContain("discoverSnapshotStore.setClient");
    expect(connectedEffect).toContain("void discoverSnapshotStore.loadSources()");
    expect(connectedEffect).toContain("librarySnapshotStore.clear()");
    expect(connectedEffect).toContain("discoverSnapshotStore.clear()");
    expect(connectedEffect).not.toContain("fetchMarketplacePlugins");
    expect(connectedEffect).not.toContain("plugins/check");
  });

  test("invalidates snapshot stores when the library changes", () => {
    const onLibraryChanged = sliceBetween(
      appSource,
      "const onLibraryChanged = useCallback",
      "const ctrl = useScopeController",
    );

    expect(onLibraryChanged).toContain("librarySnapshotStore.invalidate()");
    expect(onLibraryChanged).toContain("discoverSnapshotStore.invalidate()");
  });
});
