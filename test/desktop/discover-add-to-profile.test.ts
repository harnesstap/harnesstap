import { afterEach, describe, expect, it } from "bun:test";
import { readCachedMarketplaces } from "../../apps/desktop/src/lib/discover-marketplace-cache.ts";
import {
  DISCOVER_SOURCE_ERROR_TOOLTIP,
  discoverSourceUnreachable,
} from "../../apps/desktop/src/lib/discover-error.ts";
import { addedProfileAttachments } from "../../apps/desktop/src/lib/profile-attachment-diff.ts";
import {
  discoverAddToProfileTooltip,
  discoverAddedToProfileToast,
} from "../../apps/desktop/src/lib/sources-record-actions.ts";
import { presenceLabel, sentenceCaseDescription, sourcesHitRowDetail } from "../../apps/desktop/src/lib/sources-search.ts";
import type { MarketplaceListResult, ProfileDetail } from "../../apps/desktop/src/lib/types.ts";
import { createDiscoverSnapshotStore } from "../../apps/desktop/src/state/discover-snapshot-store.ts";

type Attachments = Pick<ProfileDetail, "dependencies" | "resources">;

function detail(deps: string[], resources: Array<{ id: string; name: string; type: string }>): Attachments {
  return {
    dependencies: deps.map((dependency_name) => ({ dependency_name })),
    resources,
  } as unknown as Attachments;
}

describe("addedProfileAttachments", () => {
  it("returns only what the add introduced, so Undo never removes earlier attachments", () => {
    const before = detail(["kept"], [{ id: "r1", name: "kept", type: "plugin" }]);
    const after = detail(
      ["kept", "fresh"],
      [
        { id: "r1", name: "kept", type: "plugin" },
        { id: "r2", name: "fresh", type: "plugin" },
        { id: "r3", name: "lint", type: "skill" },
      ],
    );
    expect(addedProfileAttachments(before, after)).toEqual([
      { dependencyName: "fresh" },
      { resourceId: "r3" },
    ]);
  });

  it("is empty when the item was already in the profile", () => {
    const same = detail(["a"], [{ id: "r1", name: "a", type: "plugin" }]);
    expect(addedProfileAttachments(same, same)).toEqual([]);
  });
});

describe("Discover copy", () => {
  it("uses plain, accurate wording", () => {
    expect(discoverAddToProfileTooltip(true)).toBe("Add to profile");
    expect(discoverAddToProfileTooltip(false)).toBe("Create a profile first");
    expect(discoverAddedToProfileToast("lint", "work")).toBe(
      "Added lint to work. Apply from the sidebar to write it.",
    );
    expect(discoverSourceUnreachable("acme")).toBe(
      "Couldn't reach acme. Check your connection, then retry.",
    );
    expect(DISCOVER_SOURCE_ERROR_TOOLTIP).toBe("Couldn't load. Retry to try again.");
    expect(presenceLabel("remote_only")).toBe("Not in your Library");
    expect(presenceLabel("in_library")).toBe("In your Library");
    expect(sentenceCaseDescription("  pstack helpers")).toBe("Pstack helpers");
    expect(sourcesHitRowDetail({ description: "lowercase start" })).toContain("Lowercase start");
  });
});

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("marketplace list fallback", () => {
  const target = globalThis as unknown as { localStorage?: unknown };
  const original = target.localStorage;
  afterEach(() => {
    target.localStorage = original;
  });

  function listResult(): MarketplaceListResult {
    return {
      marketplaces: [{ name: "acme", url: "https://example.com/acme.git", platforms: [] }],
      marketplaceRefreshMaxAgeMinutes: 60,
    } as MarketplaceListResult;
  }

  it("keeps the last known marketplaces listed when the list call fails", async () => {
    target.localStorage = new MemoryStorage();
    let fail = false;
    const fetchers = {
      fetchMarketplaces: async () => {
        if (fail) {
          throw new Error("Could not reach marketplace");
        }
        return listResult();
      },
      fetchCatalogScope: async () => ({
        defaultOrg: "harnesstap-cloud",
        publicCatalog: true,
        connectedOrgs: [],
        registered: [],
      }),
      fetchMarketplacePlugins: () => Promise.reject(new Error("unused")),
    };
    const first = createDiscoverSnapshotStore(fetchers);
    first.setClient({ baseUrl: "http://127.0.0.1:7474", token: "t" });
    await first.loadSources();
    expect(readCachedMarketplaces().map((entry) => entry.name)).toEqual(["acme"]);

    fail = true;
    const second = createDiscoverSnapshotStore(fetchers);
    second.setClient({ baseUrl: "http://127.0.0.1:7474", token: "t" });
    await second.loadSources();
    expect(second.getState().error).toContain("Could not reach marketplace");
    expect(second.getState().marketplaces.map((entry) => entry.name)).toEqual(["acme"]);
  });

  it("ignores a corrupt cache", () => {
    const storage = new MemoryStorage();
    storage.setItem("ht.desktop.discover.marketplaces.v1", "{not json");
    target.localStorage = storage;
    expect(readCachedMarketplaces()).toEqual([]);
  });
});
