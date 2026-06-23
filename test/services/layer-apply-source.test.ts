import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { resolveApplyLayerSource } from "../../src/services/layer-apply-source.ts";
import { LayerAmbiguityError, LayerResolveError } from "../../src/services/layer-bare-name-resolve.ts";
import { createLayer, updateLayerPublishedIdentity } from "../../src/models/layer-model.ts";
import { connectCatalogOrg, saveCatalogSettings } from "../../src/config/catalog.ts";

describe("resolveApplyLayerSource", () => {
  it("installs a published selector from the catalog when missing locally", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-remote");
    try {
      const cloudAccounts = await import("../../src/config/cloud-accounts.ts");
      await cloudAccounts.saveCloudAccount("test", {
        cloudBaseUrl: "https://mock",
        accessToken: "tok",
        accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        refreshToken: "r",
        scopes: [],
      });
      await cloudAccounts.setDefaultCloudAccount("test");

      const restoreFetch = createCatalogFetchMock({ baseUrl: "https://mock" });
      const fetchedLabels: string[] = [];

      const resolved = await resolveApplyLayerSource("harnessdeck-cloud/default/team@1.0", {
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved).toEqual({ kind: "local", layerId: expect.any(String) });
      expect(fetchedLabels).toEqual(["harnessdeck-cloud/team@1.0"]);

      const second = await resolveApplyLayerSource("harnessdeck-cloud/default/team@1.0");
      expect(second).toEqual(resolved);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a unique bare name from the public catalog", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-bare");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [{
          orgSlug: "harnessdeck-cloud",
          slug: "engineering-foundation",
          name: "Engineering foundation",
          summary: "Shared baseline",
          latestVersion: "1.0.0",
          updatedAt: new Date().toISOString(),
          tags: ["foundation"],
          visibility: "public",
        }],
      });
      const fetchedLabels: string[] = [];

      const resolved = await resolveApplyLayerSource("engineering-foundation", {
        baseUrl: "https://mock",
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved.kind).toBe("local");
      expect(fetchedLabels).toEqual(["harnessdeck-cloud/engineering-foundation@1.0.0"]);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects ambiguous bare names with candidate selectors", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-ambiguous");
    try {
      const harnessdeckDir = join(context.homeDir, ".harnessdeck");
      mkdirSync(harnessdeckDir, { recursive: true });
      connectCatalogOrg("acme", harnessdeckDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [
          {
            orgSlug: "harnessdeck-cloud",
            slug: "team",
            name: "Team",
            summary: "A",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "acme",
            slug: "team",
            name: "Team",
            summary: "B",
            latestVersion: "2.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
      });

      await expect(
        resolveApplyLayerSource("team", {
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

  it("resolves ambiguous bare names interactively", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-ambiguous-prompt");
    try {
      const harnessdeckDir = join(context.homeDir, ".harnessdeck");
      mkdirSync(harnessdeckDir, { recursive: true });
      connectCatalogOrg("acme", harnessdeckDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [
          {
            orgSlug: "harnessdeck-cloud",
            slug: "team",
            name: "Team",
            summary: "A",
            latestVersion: "1.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
          {
            orgSlug: "acme",
            slug: "team",
            name: "Team",
            summary: "B",
            latestVersion: "2.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
      });

      const resolved = await resolveApplyLayerSource("team", {
        baseUrl: "https://mock",
        interactive: true,
        promptAmbiguity: async ({ candidates }) =>
          candidates.find((layer) => layer.orgSlug === "acme")!,
      });

      expect(resolved.kind).toBe("local");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects bare names when public catalog is disabled", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-no-public");
    try {
      const harnessdeckDir = join(context.homeDir, ".harnessdeck");
      mkdirSync(harnessdeckDir, { recursive: true });
      saveCatalogSettings({ publicCatalog: false }, harnessdeckDir);

      await expect(resolveApplyLayerSource("engineering-foundation")).rejects.toBeInstanceOf(
        LayerResolveError,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects unpublished selectors that are missing locally", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-missing");
    try {
      await expect(resolveApplyLayerSource("missing-local-layer")).rejects.toThrow(
        "Layer not found: missing-local-layer",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prefers a locally installed published layer over catalog fetch for bare names", async () => {
    const context = await createInitializedTestContext("resolve-apply-layer-source-local-published");
    try {
      const layer = createLayer({ name: "team", version: "1.0.0" });
      updateLayerPublishedIdentity(layer.id, {
        org_slug: "acme",
        catalog_slug: "default",
        version: "1.0.0",
      });

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        layers: [
          {
            orgSlug: "harnessdeck-cloud",
            slug: "team",
            name: "Team",
            summary: "Remote",
            latestVersion: "9.0.0",
            updatedAt: new Date().toISOString(),
            tags: [],
            visibility: "public",
          },
        ],
      });
      const fetchedLabels: string[] = [];

      const resolved = await resolveApplyLayerSource("team", {
        baseUrl: "https://mock",
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved).toEqual({ kind: "local", layerId: layer.id });
      expect(fetchedLabels).toEqual([]);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });
});
