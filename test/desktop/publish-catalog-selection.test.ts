import { describe, expect, test } from "bun:test";
import {
  catalogKey,
  checkAllCheckboxState,
  parseCatalogKey,
  readRememberedCatalogKeys,
  resolveCheckedCatalogKeys,
  storageKeyForPublishCatalogs,
  writeRememberedCatalogKeys,
} from "../../apps/desktop/src/lib/publish-catalog-selection.ts";

describe("publish catalog selection", () => {
  test("parses org/catalog keys", () => {
    expect(catalogKey("acme", "core")).toBe("acme/core");
    expect(parseCatalogKey("acme/core")).toEqual({ org: "acme", catalog: "core" });
    expect(parseCatalogKey("nopath")).toBeNull();
  });

  test("defaults to every registered catalog when nothing is remembered", () => {
    expect(
      resolveCheckedCatalogKeys({
        registeredKeys: ["acme/core", "acme/ops"],
        rememberedKeys: null,
      }),
    ).toEqual(["acme/core", "acme/ops"]);
  });

  test("keeps the previous checkbox set when those catalogs still exist", () => {
    expect(
      resolveCheckedCatalogKeys({
        registeredKeys: ["acme/core", "acme/ops"],
        rememberedKeys: ["acme/ops"],
      }),
    ).toEqual(["acme/ops"]);
  });

  test("remembers an empty selection", () => {
    expect(
      resolveCheckedCatalogKeys({
        registeredKeys: ["acme/core"],
        rememberedKeys: [],
      }),
    ).toEqual([]);
  });

  test("falls back to all registered when remembered catalogs are gone", () => {
    expect(
      resolveCheckedCatalogKeys({
        registeredKeys: ["acme/new"],
        rememberedKeys: ["acme/old"],
      }),
    ).toEqual(["acme/new"]);
  });

  test("check-all is mixed when some catalogs are selected", () => {
    expect(checkAllCheckboxState(3, 0)).toBe(false);
    expect(checkAllCheckboxState(3, 3)).toBe(true);
    expect(checkAllCheckboxState(3, 1)).toBe("indeterminate");
    expect(checkAllCheckboxState(0, 0)).toBe(false);
  });

  test("round-trips remembered keys through storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    writeRememberedCatalogKeys("default", ["acme/core"], storage);
    expect(store.get(storageKeyForPublishCatalogs("default"))).toBe(
      JSON.stringify(["acme/core"]),
    );
    expect(readRememberedCatalogKeys("default", storage)).toEqual(["acme/core"]);
    expect(readRememberedCatalogKeys("missing", storage)).toBeNull();
  });
});
