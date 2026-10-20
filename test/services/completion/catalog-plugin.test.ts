import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import * as catalogClient from "../../../src/services/catalog-client.ts";
import * as cloudAccounts from "../../../src/config/cloud-accounts.ts";
import { completeCatalogPlugins } from "../../../src/services/completion/providers/catalog-plugin.ts";

// spyOn, not mock.module: a module mock stays in place for every later test
// file in the same bun process, so it would leak into unrelated suites.
const listPluginsInScopeMock = spyOn(catalogClient, "listPluginsInScope").mockImplementation(
  () => Promise.resolve([]),
);
const getCloudAccountMock = spyOn(cloudAccounts, "getCloudAccount").mockImplementation(() =>
  Promise.resolve({ accountName: undefined, account: undefined }),
);

afterAll(() => {
  listPluginsInScopeMock.mockRestore();
  getCloudAccountMock.mockRestore();
});

afterEach(() => {
  listPluginsInScopeMock.mockClear();
  getCloudAccountMock.mockClear();
});

describe("completeCatalogPlugins", () => {
  it("returns empty output without an authenticated account", async () => {
    const candidates = await completeCatalogPlugins({
      commandPath: ["plugin", "pull"],
      slot: "positional",
      positionalIndex: 0,
      prefix: "",
      localDataAvailable: true,
    });

    expect(candidates).toEqual([]);
    expect(listPluginsInScopeMock).not.toHaveBeenCalled();
  });

  it("maps catalog plugins to published selectors when authenticated", async () => {
    getCloudAccountMock.mockImplementationOnce(() =>
      Promise.resolve({
        accountName: "work",
        account: {
          cloudBaseUrl: "https://example.test",
          accessToken: "token",
          scopes: [],
        },
      }),
    );
    listPluginsInScopeMock.mockImplementationOnce(() =>
      Promise.resolve([
        {
          orgSlug: "acme",
          catalogSlug: "default",
          slug: "foundation",
          name: "Foundation",
          summary: "",
          latestVersion: "1.2.0",
          updatedAt: null,
          tags: [],
          visibility: "public" as const,
        },
      ]),
    );

    const candidates = await completeCatalogPlugins({
      commandPath: ["plugin", "pull"],
      slot: "positional",
      positionalIndex: 0,
      prefix: "ac",
      localDataAvailable: true,
    });

    expect(listPluginsInScopeMock).toHaveBeenCalled();
    expect(candidates.map((entry) => entry.value)).toContain("acme/foundation");
    expect(candidates.map((entry) => entry.value)).toContain("acme/foundation@1.2.0");
  });
});
