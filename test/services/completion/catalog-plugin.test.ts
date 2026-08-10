import { afterEach, describe, expect, it, mock } from "bun:test";
import { completeCatalogPlugins } from "../../../src/services/completion/providers/catalog-plugin.ts";

const listPluginsInScopeMock = mock(() => Promise.resolve([]));
const getCloudAccountMock = mock(() =>
  Promise.resolve({ accountName: undefined, account: undefined }),
);

mock.module("../../../src/services/catalog-client.ts", () => ({
  listPluginsInScope: listPluginsInScopeMock,
}));

mock.module("../../../src/config/cloud-accounts.ts", () => ({
  getCloudAccount: getCloudAccountMock,
}));

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
