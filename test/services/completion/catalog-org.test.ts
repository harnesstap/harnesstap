import { afterAll, afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as cloudClient from "../../../src/services/cloud-client.ts";
import * as cloudAccounts from "../../../src/config/cloud-accounts.ts";
import { completeCatalogOrgs } from "../../../src/services/completion/providers/catalog-org.ts";

// spyOn, not mock.module: a module mock stays in place for every later test
// file in the same bun process, so it would leak into unrelated suites.
const listOrgsMock = mock(() => Promise.resolve([]));
const createCloudClientMock = spyOn(cloudClient, "createCloudClient").mockImplementation(
  () => ({ listOrgs: listOrgsMock }) as unknown as ReturnType<typeof cloudClient.createCloudClient>,
);
const getCloudAccountMock = spyOn(cloudAccounts, "getCloudAccount").mockImplementation(() =>
  Promise.resolve({ accountName: undefined, account: undefined }),
);

afterAll(() => {
  createCloudClientMock.mockRestore();
  getCloudAccountMock.mockRestore();
});

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
