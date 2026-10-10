import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { makeApEnvelope } from "../helpers/ap-package-fixtures.ts";
import { CatalogDependencyVersionError } from "../../src/services/catalog-package-errors.ts";
import { installPluginFromCatalog } from "../../src/services/plugin-catalog-install.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { createPlugin, getPluginByName } from "../../src/models/plugin-model.ts";
import { resolveComposition } from "../../src/services/resolve/index.ts";

describe("catalog missing-dependency resolution", () => {
  it("fetches local-source deps from the parent catalog, including transitive packages", async () => {
    const context = await createInitializedTestContext("catalog-dep-resolve");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "engineering-foundation",
            name: "Engineering foundation",
            summary: "Shared baseline",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: ["foundation"],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "superpowers",
            name: "superpowers",
            summary: "Skills",
            latestVersion: "5.1.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "confidence",
            name: "confidence",
            summary: "Nested",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
        packages: {
          "harnesstap-cloud/default/engineering-foundation@1.0.0": makeApEnvelope({
            name: "engineering-foundation",
            version: "1.0.0",
            omitSchema: true,
            skillName: "baseline",
            dependencies: [
              { name: "superpowers", constraint: "5.1.0", source: "local" },
            ],
          }),
          "harnesstap-cloud/default/superpowers@5.1.0": makeApEnvelope({
            name: "superpowers",
            version: "5.1.0",
            skillName: "superpowers",
            dependencies: [
              { name: "confidence", constraint: "1.0.0", source: "local" },
            ],
          }),
          "harnesstap-cloud/default/confidence@1.0.0": makeApEnvelope({
            name: "confidence",
            version: "1.0.0",
            skillName: "confidence",
          }),
        },
      });

      const fetched: string[] = [];
      await installPluginFromCatalog(
        {
          org_slug: "harnesstap-cloud",
          catalog_slug: "default",
          plugin_slug: "engineering-foundation",
          version: "1.0.0",
        },
        { baseUrl: "https://mock", onFetched: (label) => fetched.push(label) },
      );

      expect(getPluginByName("engineering-foundation", "1.0.0")).toBeDefined();
      expect(getPluginByName("superpowers", "5.1.0")).toBeDefined();
      expect(getPluginByName("confidence", "1.0.0")).toBeDefined();
      expect(fetched).toEqual(
        expect.arrayContaining([
          "harnesstap-cloud/superpowers@5.1.0",
          "harnesstap-cloud/confidence@1.0.0",
        ]),
      );

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("errors with dep name, version, catalog, and available versions when the pin is missing", async () => {
    const context = await createInitializedTestContext("catalog-dep-missing-version");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
            slug: "engineering-foundation",
            name: "Engineering foundation",
            summary: "Shared baseline",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "harnesstap-cloud",
            slug: "superpowers",
            name: "superpowers",
            summary: "Skills",
            latestVersion: "5.1.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
        packages: {
          "harnesstap-cloud/default/engineering-foundation@1.0.0": makeApEnvelope({
            name: "engineering-foundation",
            version: "1.0.0",
            omitSchema: true,
            dependencies: [
              { name: "superpowers", constraint: "9.9.9", source: "local" },
            ],
          }),
          "harnesstap-cloud/default/superpowers@5.1.0": makeApEnvelope({
            name: "superpowers",
            version: "5.1.0",
            skillName: "superpowers",
          }),
        },
      });

      await expect(
        installPluginFromCatalog(
          {
            org_slug: "harnesstap-cloud",
            catalog_slug: "default",
            plugin_slug: "engineering-foundation",
            version: "1.0.0",
          },
          { baseUrl: "https://mock" },
        ),
      ).rejects.toMatchObject({
        name: "CatalogDependencyVersionError",
        pluginName: "superpowers",
        version: "9.9.9",
        catalog: "harnesstap-cloud/default",
        available: ["5.1.0"],
      });

      try {
        await installPluginFromCatalog(
          {
            org_slug: "harnesstap-cloud",
            catalog_slug: "default",
            plugin_slug: "engineering-foundation",
            version: "1.0.0",
          },
          { baseUrl: "https://mock" },
        );
      } catch (error) {
        expect(error).toBeInstanceOf(CatalogDependencyVersionError);
        expect((error as Error).message).toContain("superpowers");
        expect((error as Error).message).toContain("9.9.9");
        expect((error as Error).message).toContain("harnesstap-cloud/default");
        expect((error as Error).message).toContain("5.1.0");
      }

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("leaves truly local-only missing deps for inventory errors", async () => {
    const context = await createInitializedTestContext("catalog-dep-local-only");
    try {
      const root = createPlugin({ name: "my-setup", version: "1.0.0" });
      addDependency(root.id, "design-doc", { versionConstraint: "1.0.0" });
      expect(() =>
        resolveComposition({ rootSelectors: ["my-setup@1.0.0"] }),
      ).toThrow(/No local version of design-doc is installed/);
    } finally {
      await context.cleanup();
    }
  });
});
