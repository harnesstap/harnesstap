import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  connectCatalogLibrary,
  connectCatalogOrg,
  DEFAULT_CATALOG_ORG_SLUG,
  disconnectCatalogOrg,
  loadCatalogSettings,
  resolveCatalogScope,
} from "../../src/config/catalog.js";

describe("catalog config", () => {
  it("always includes the default harnessdeck-cloud org in scope", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-catalog-"));
    const scope = resolveCatalogScope({ harnessdeckDir: dir });
    expect(scope.orgs).toEqual([DEFAULT_CATALOG_ORG_SLUG]);
  });

  it("persists connected orgs without storing the default org slug", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-catalog-"));
    connectCatalogOrg("acme", dir);
    connectCatalogLibrary("partner/design", dir);

    const settings = loadCatalogSettings(dir);
    expect(settings.connectedOrgs).toEqual(["acme"]);
    expect(settings.connectedLibraries).toEqual(["partner/design"]);

    const saved = JSON.parse(readFileSync(join(dir, "config.jsonc"), "utf-8")) as {
      catalog: { connectedOrgs: string[] };
    };
    expect(saved.catalog.connectedOrgs).not.toContain(DEFAULT_CATALOG_ORG_SLUG);
  });

  it("rejects disconnecting the default catalog org", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-catalog-"));
    expect(() => disconnectCatalogOrg(DEFAULT_CATALOG_ORG_SLUG, dir)).toThrow(
      /Cannot disconnect the default catalog org/,
    );
  });
});
