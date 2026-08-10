import { afterEach, describe, expect, it, mock } from "bun:test";
import { completeCatalogOrgs } from "../../../src/services/completion/providers/catalog-org.ts";

const listOrgsMock = mock(() => Promise.resolve([]));
const getCloudAccountMock = mock(() =>
  Promise.resolve({ accountName: undefined, account: undefined }),
);

mock.module("../../../src/services/cloud-client.js", () => ({
  createCloudClient: () => ({
    listOrgs: listOrgsMock,
  }),
}));

mock.module("../../../src/config/cloud-accounts.js", () => ({
  getCloudAccount: getCloudAccountMock,
}));

afterEach(() => {
  listOrgsMock.mockClear();
  getCloudAccountMock.mockClear();
});

describe("completeCatalogOrgs", () => {
  it("returns empty output without an authenticated account", async () => {
    const candidates = await completeCatalogOrgs({
      commandPath: ["plugin", "publish"],
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
    listOrgsMock.mockImplementationOnce(() =>
      Promise.resolve([
        { slug: "acme", name: "Acme Corp" },
        { slug: "demo", name: "Demo Org" },
      ]),
    );

    const candidates = await completeCatalogOrgs({
      commandPath: ["plugin", "publish"],
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
