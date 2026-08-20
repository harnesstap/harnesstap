import { describe, expect, test } from "bun:test";
import {
  buildSourceRows,
  defaultCheckedSourceIds,
} from "../../apps/desktop/src/lib/sources-sidebar.ts";

describe("buildSourceRows", () => {
  test("orders local, marketplaces, default org, other orgs, then registered catalogs", () => {
    const rows = buildSourceRows({
      marketplaces: [{ name: "teads" }, { name: "demo" }],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["acme", "other"],
      registered: [
        { org: "acme", catalog: "internal" },
        { org: "acme", catalog: "default" },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual([
      "local",
      "mkt:teads",
      "mkt:demo",
      "org:harnesstap-cloud",
      "org:acme",
      "org:other",
      "cat:acme/internal",
      "cat:acme/default",
    ]);
    expect(rows.map((row) => row.kind)).toEqual([
      "local",
      "marketplace",
      "marketplace",
      "cloud-org",
      "cloud-org",
      "cloud-org",
      "cloud-catalog",
      "cloud-catalog",
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "Local",
      "teads",
      "demo",
      "harnesstap-cloud",
      "acme",
      "other",
      "acme/internal",
      "acme/default",
    ]);
  });

  test("local and default org are not removable; default org forbids disconnect", () => {
    const rows = buildSourceRows({
      marketplaces: [{ name: "demo" }],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["acme"],
      registered: [{ org: "acme", catalog: "internal" }],
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.local).toMatchObject({ removable: false });
    expect(byId["org:harnesstap-cloud"]).toMatchObject({
      removable: false,
      disconnectForbidden: true,
    });
    expect(byId["mkt:demo"]).toMatchObject({ removable: true });
    expect(byId["org:acme"]).toMatchObject({ removable: true });
    expect(byId["cat:acme/internal"]).toMatchObject({ removable: true });
  });

  test("does not duplicate the default org when it also appears in connectedOrgs", () => {
    const rows = buildSourceRows({
      marketplaces: [],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["harnesstap-cloud", "acme"],
      registered: [],
    });
    expect(rows.map((row) => row.id)).toEqual([
      "local",
      "org:harnesstap-cloud",
      "org:acme",
    ]);
  });

  test("default checked ids are every row id", () => {
    const rows = buildSourceRows({
      marketplaces: [{ name: "demo" }],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["acme"],
      registered: [{ org: "acme", catalog: "internal" }],
    });
    expect(defaultCheckedSourceIds(rows)).toEqual(rows.map((row) => row.id));
  });
});
