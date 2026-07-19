import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  connectCatalogLayer,
  connectCatalogOrg,
  DEFAULT_CATALOG_ORG_SLUG,
  disconnectCatalogOrg,
  isPublicCatalogEnabled,
  loadCatalogSettings,
  resolveCatalogScope,
  saveCatalogSettings,
} from "../../src/config/catalog.js";

describe("catalog config", () => {
  it("always includes the default harnesstap-cloud org in scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-catalog-"));
    const scope = resolveCatalogScope({ harnesstapDir: dir });
    expect(scope.orgs).toEqual([DEFAULT_CATALOG_ORG_SLUG]);
  });

  it("persists connected orgs without storing the default org slug", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-catalog-"));
    connectCatalogOrg("acme", dir);
    connectCatalogLayer("partner/default/design", dir);

    const settings = loadCatalogSettings(dir);
    expect(settings.connectedOrgs).toEqual(["acme"]);
    expect(settings.connectedLayers).toEqual(["partner/default/design"]);

    const saved = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8")) as {
      catalog: { connectedOrgs: string[] };
    };
    expect(saved.catalog.connectedOrgs).not.toContain(DEFAULT_CATALOG_ORG_SLUG);
  });

  it("rejects disconnecting the default catalog org", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-catalog-"));
    expect(() => disconnectCatalogOrg(DEFAULT_CATALOG_ORG_SLUG, dir)).toThrow(
      /Cannot disconnect the default catalog org/,
    );
  });

  it("defaults publicCatalog to true and persists overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-catalog-public-"));
    expect(isPublicCatalogEnabled(dir)).toBe(true);

    saveCatalogSettings({ publicCatalog: false }, dir);
    expect(loadCatalogSettings(dir).publicCatalog).toBe(false);
    expect(isPublicCatalogEnabled(dir)).toBe(false);
  });

  it("honors HARNESSTAP_PUBLIC_CATALOG=0", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-catalog-env-"));
    const previous = process.env.HARNESSTAP_PUBLIC_CATALOG;
    process.env.HARNESSTAP_PUBLIC_CATALOG = "0";
    expect(isPublicCatalogEnabled(dir)).toBe(false);
    process.env.HARNESSTAP_PUBLIC_CATALOG = previous;
  });
});
