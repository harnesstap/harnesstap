import { afterEach, describe, expect, it, mock } from "bun:test";
import { completeCatalogOrgs } from "../../../src/services/completion/providers/catalog-org.ts";

const listOrgsMock = mock(() => Promise.resolve([]));
const getCloudProfileMock = mock(() =>
  Promise.resolve({ profileName: undefined, profile: undefined }),
);

mock.module("../../../src/services/cloud-client.js", () => ({
  createCloudClient: () => ({
    listOrgs: listOrgsMock,
  }),
}));

mock.module("../../../src/config/cloud-profiles.js", () => ({
  getCloudProfile: getCloudProfileMock,
}));

afterEach(() => {
  listOrgsMock.mockClear();
  getCloudProfileMock.mockClear();
});

describe("completeCatalogOrgs", () => {
  it("returns empty output without an authenticated profile", async () => {
    const candidates = await completeCatalogOrgs({
      commandPath: ["layer", "publish"],
      slot: "flag-value",
      flag: "org",
      positionalIndex: 0,
      prefix: "",
      localDataAvailable: true,
    });

    expect(candidates).toEqual([]);
    expect(listOrgsMock).not.toHaveBeenCalled();
  });

  it("maps catalog orgs to slug candidates when authenticated", async () => {
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
    listOrgsMock.mockImplementationOnce(() =>
      Promise.resolve([
        { slug: "acme", name: "Acme Corp" },
        { slug: "demo", name: "Demo Org" },
      ]),
    );

    const candidates = await completeCatalogOrgs({
      commandPath: ["layer", "publish"],
      slot: "flag-value",
      flag: "org",
      positionalIndex: 0,
      prefix: "ac",
      localDataAvailable: true,
    });

    expect(listOrgsMock).toHaveBeenCalled();
    expect(candidates).toEqual([
      { value: "acme", description: "Acme Corp" },
    ]);
  });
});
