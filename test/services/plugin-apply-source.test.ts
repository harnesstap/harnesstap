import { describe, expect, it } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createCatalogFetchMock } from "../helpers/catalog-fetch.ts";
import { resolveApplyPluginSource } from "../../src/services/plugin-apply-source.ts";
import { PluginAmbiguityError, PluginResolveError } from "../../src/services/plugin-bare-name-resolve.ts";
import { createPlugin, updatePluginPublishedIdentity } from "../../src/models/plugin-model.ts";
import { connectCatalogOrg, saveCatalogSettings } from "../../src/config/catalog.ts";

describe("resolveApplyPluginSource", () => {
  it("installs a published selector from the catalog when missing locally", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-remote");
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

      const resolved = await resolveApplyPluginSource("harnesstap-cloud/default/team@1.0", {
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved).toEqual({ kind: "local", pluginId: expect.any(String) });
      expect(fetchedLabels).toEqual(["harnesstap-cloud/team@1.0"]);

      const second = await resolveApplyPluginSource("harnesstap-cloud/default/team@1.0");
      expect(second).toEqual(resolved);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("resolves a unique bare name from the public catalog", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-bare");
    try {
      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [{
          orgSlug: "harnesstap-cloud",
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

      const resolved = await resolveApplyPluginSource("engineering-foundation", {
        baseUrl: "https://mock",
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved.kind).toBe("local");
      expect(fetchedLabels).toEqual(["harnesstap-cloud/engineering-foundation@1.0.0"]);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects ambiguous bare names with candidate selectors", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-ambiguous");
    try {
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      connectCatalogOrg("acme", harnesstapDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
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
        resolveApplyPluginSource("team", {
          baseUrl: "https://mock",
          noInteractive: true,
          format: "human",
        }),
      ).rejects.toBeInstanceOf(PluginAmbiguityError);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("resolves ambiguous bare names interactively", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-ambiguous-prompt");
    try {
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      connectCatalogOrg("acme", harnesstapDir);

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
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

      const resolved = await resolveApplyPluginSource("team", {
        baseUrl: "https://mock",
        interactive: true,
        promptAmbiguity: async ({ candidates }) => {
          const match = candidates.find((plugin) => plugin.orgSlug === "acme");
          if (!match) {
            throw new Error("Expected acme org candidate");
          }
          return match;
        },
      });

      expect(resolved.kind).toBe("local");

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });

  it("rejects bare names when public catalog is disabled", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-no-public");
    try {
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      saveCatalogSettings({ publicCatalog: false }, harnesstapDir);

      await expect(resolveApplyPluginSource("engineering-foundation")).rejects.toBeInstanceOf(
        PluginResolveError,
      );
    } finally {
      await context.cleanup();
    }
  });

  it("rejects unpublished selectors that are missing locally", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-missing");
    try {
      const harnesstapDir = join(context.homeDir, ".harnesstap");
      mkdirSync(harnesstapDir, { recursive: true });
      saveCatalogSettings({ publicCatalog: false }, harnesstapDir);

      await expect(resolveApplyPluginSource("missing-local-plugin")).rejects.toThrow(
        "Plugin not found: missing-local-plugin",
      );
    } finally {
      await context.cleanup();
    }
  });

  it("prefers a locally installed published plugin over catalog fetch for bare names", async () => {
    const context = await createInitializedTestContext("resolve-apply-plugin-source-local-published");
    try {
      const plugin = createPlugin({ name: "team", version: "1.0.0" });
      updatePluginPublishedIdentity(plugin.id, {
        org_slug: "acme",
        catalog_slug: "default",
        version: "1.0.0",
      });

      const restoreFetch = createCatalogFetchMock({
        baseUrl: "https://mock",
        plugins: [
          {
            orgSlug: "harnesstap-cloud",
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

      const resolved = await resolveApplyPluginSource("team", {
        baseUrl: "https://mock",
        onFetched: (label) => fetchedLabels.push(label),
      });

      expect(resolved).toEqual({ kind: "local", pluginId: plugin.id });
      expect(fetchedLabels).toEqual([]);

      restoreFetch();
    } finally {
      await context.cleanup();
    }
  });
});
