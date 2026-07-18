import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { connectCatalogOrg } from "../../src/config/catalog.ts";
import {
  LayerAmbiguityError,
  LayerResolveError,
  resolveBareNameFromCatalog,
  resolveInstallSelector,
  isBareInstallSelector,
} from "../../src/services/layer-bare-name-resolve.ts";

const teamLayers = [
  {
    orgSlug: "harnesstap-cloud",
    catalogSlug: "default",
    slug: "team",
    name: "Team",
    summary: "Public team layer",
    latestVersion: "1.0.0",
    updatedAt: new Date().toISOString(),
    tags: [],
    visibility: "public" as const,
  },
  {
    orgSlug: "acme",
    catalogSlug: "default",
    slug: "team",
    name: "Team",
    summary: "Acme team layer",
    latestVersion: "2.0.0",
    updatedAt: new Date().toISOString(),
    tags: [],
    visibility: "public" as const,
  },
];

const [firstTeamLayer] = teamLayers;
if (!firstTeamLayer) {
  throw new Error("Expected team layer fixture");
}

describe("resolveBareNameFromCatalog", () => {
  it("rejects ambiguous bare slugs in non-interactive mode", async () => {
    const context = await createInitializedTestContext("bare-name-ambiguous");
    try {
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      connectCatalogOrg("acme", harnesstapDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: teamLayers,
      });

      await expect(
        resolveBareNameFromCatalog("team", {
          baseUrl: "https://mock",
          noInteractive: true,
          format: "human",
        }),
      ).rejects.toBeInstanceOf(LayerAmbiguityError);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("resolves ambiguous bare slugs when a candidate is chosen interactively", async () => {
    const context = await createInitializedTestContext("bare-name-prompt");
    try {
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      connectCatalogOrg("acme", harnesstapDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: teamLayers,
      });

      const resolved = await resolveBareNameFromCatalog("team", {
        baseUrl: "https://mock",
        interactive: true,
        promptAmbiguity: async ({ candidates }) => {
          const acme = candidates.find((layer) => layer.orgSlug === "acme");
          if (!acme) {
            throw new Error("Expected acme candidate");
          }
          return acme;
        },
      });

      expect(resolved).toEqual({
        org_slug: "acme",
        catalog_slug: "default",
        layer_slug: "team",
        version: "2.0.0",
      });

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("dedupes duplicate catalog rows by org/catalog/slug identity", async () => {
    const context = await createInitializedTestContext("bare-name-dedupe");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [
          firstTeamLayer,
          { ...firstTeamLayer, summary: "Duplicate list row" },
        ],
      });

      const resolved = await resolveBareNameFromCatalog("team", {
        baseUrl: "https://mock",
      });

      expect(resolved.org_slug).toBe("harnesstap-cloud");
      expect(resolved.layer_slug).toBe("team");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects unknown bare slugs", async () => {
    const context = await createInitializedTestContext("bare-name-missing");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [],
      });

      await expect(
        resolveBareNameFromCatalog("missing-layer", { baseUrl: "https://mock" }),
      ).rejects.toBeInstanceOf(LayerResolveError);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });
});

describe("resolveInstallSelector", () => {
  it("routes bare selectors through catalog bare resolve", async () => {
    const context = await createInitializedTestContext("install-selector-bare");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [firstTeamLayer],
      });

      const resolved = await resolveInstallSelector("team", { baseUrl: "https://mock" });
      expect(resolved.org_slug).toBe("harnesstap-cloud");
      expect(resolved.layer_slug).toBe("team");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("routes qualified selectors through remote layer selector", async () => {
    const resolved = await resolveInstallSelector("acme/default/team@2.0.0");
    expect(resolved).toEqual({
      org_slug: "acme",
      catalog_slug: "default",
      layer_slug: "team",
      version: "2.0.0",
    });
  });

  it("routes bare selectors with --org through remote layer selector", async () => {
    const resolved = await resolveInstallSelector("my-library", {
      org: "harnesstap-cloud",
      version: "latest",
    });
    expect(resolved).toEqual({
      org_slug: "harnesstap-cloud",
      catalog_slug: "default",
      layer_slug: "my-library",
      version: "latest",
    });
  });

  it("requires org for bare selectors when public catalog is disabled", async () => {
    const context = await createInitializedTestContext("install-selector-no-catalog");
    try {
      const catalog = await import("../../src/config/catalog.ts");
      catalog.saveCatalogSettings(
        { publicCatalog: false },
        join(context.homeDir, ".harnesstap"),
      );

      await expect(
        resolveInstallSelector("library-name"),
      ).rejects.toThrow("org is required");
    } finally {
      await context.cleanup();
    }
  });

  it("detects bare install selectors", () => {
    expect(isBareInstallSelector("team")).toBe(true);
    expect(isBareInstallSelector("acme/default/team")).toBe(false);
    expect(isBareInstallSelector("https://example.com/layer.tgz")).toBe(false);
  });
});
