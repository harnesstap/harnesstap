import { afterEach, describe, expect, it, mock } from "bun:test";
import { completeCatalogProfiles } from "../../../src/services/completion/providers/catalog-profile.ts";

const listLayersInScopeMock = mock(() => Promise.resolve([]));
const getCloudAccountMock = mock(() =>
  Promise.resolve({ accountName: undefined, account: undefined }),
);

mock.module("../../../src/services/catalog-client.ts", () => ({
  listLayersInScope: listLayersInScopeMock,
}));

mock.module("../../../src/config/cloud-accounts.ts", () => ({
  getCloudAccount: getCloudAccountMock,
}));

afterEach(() => {
  listLayersInScopeMock.mockClear();
  getCloudAccountMock.mockClear();
});

describe("completeCatalogProfiles", () => {
  it("returns empty output without an authenticated account", async () => {
    const candidates = await completeCatalogProfiles({
      commandPath: ["profile", "pull"],
      slot: "positional",
      positionalIndex: 0,
      prefix: "",
      localDataAvailable: true,
    });

    expect(candidates).toEqual([]);
    expect(listLayersInScopeMock).not.toHaveBeenCalled();
  });

  it("requests catalog results with profile tag filter", async () => {
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
    listLayersInScopeMock.mockImplementationOnce(() =>
      Promise.resolve([
        {
          orgSlug: "acme",
          catalogSlug: "default",
          slug: "work",
          name: "Work Profile",
          summary: "",
          latestVersion: "1.2.0",
          updatedAt: null,
          tags: ["profile"],
          visibility: "public" as const,
        },
      ]),
    );

    const candidates = await completeCatalogProfiles({
      commandPath: ["profile", "pull"],
      slot: "positional",
      positionalIndex: 0,
      prefix: "ac",
      localDataAvailable: true,
    });

    expect(listLayersInScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "profile",
      }),
      { account: "work" },
    );
    expect(candidates.map((entry) => entry.value)).toContain("acme/work");
    expect(candidates.map((entry) => entry.value)).toContain("acme/work@1.2.0");
  });
});
