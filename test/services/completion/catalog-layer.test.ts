import { afterEach, describe, expect, it, mock } from "bun:test";
import { completeCatalogLayers } from "../../../src/services/completion/providers/catalog-layer.ts";

const listLayersInScopeMock = mock(() => Promise.resolve([]));
const getCloudProfileMock = mock(() =>
  Promise.resolve({ profileName: undefined, profile: undefined }),
);

mock.module("../../../src/services/catalog-client.ts", () => ({
  listLayersInScope: listLayersInScopeMock,
}));

mock.module("../../../src/config/cloud-profiles.ts", () => ({
  getCloudProfile: getCloudProfileMock,
}));

afterEach(() => {
  listLayersInScopeMock.mockClear();
  getCloudProfileMock.mockClear();
});

describe("completeCatalogLayers", () => {
  it("returns empty output without an authenticated profile", async () => {
    const candidates = await completeCatalogLayers({
      commandPath: ["layer", "pull"],
      slot: "positional",
      positionalIndex: 0,
      prefix: "",
      localDataAvailable: true,
    });

    expect(candidates).toEqual([]);
    expect(listLayersInScopeMock).not.toHaveBeenCalled();
  });

  it("maps catalog layers to published selectors when authenticated", async () => {
    getCloudProfileMock.mockImplementationOnce(() =>
      Promise.resolve({
        profileName: "work",
        profile: {
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

    const candidates = await completeCatalogLayers({
      commandPath: ["layer", "pull"],
      slot: "positional",
      positionalIndex: 0,
      prefix: "ac",
      localDataAvailable: true,
    });

    expect(listLayersInScopeMock).toHaveBeenCalled();
    expect(candidates.map((entry) => entry.value)).toContain("acme/foundation");
    expect(candidates.map((entry) => entry.value)).toContain("acme/foundation@1.2.0");
  });
});
