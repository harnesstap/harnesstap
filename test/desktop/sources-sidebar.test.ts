import { describe, expect, test } from "bun:test";
import {
  buildSourceRows,
  defaultCheckedSourceIds,
  groupSourceRows,
  isSourcesFilterActive,
  nextCheckedSourceIds,
  sourceCheckState,
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

  test("host-only marketplaces are listed but not removable", () => {
    const rows = buildSourceRows({
      marketplaces: [
        { name: "teads-plugins", managed: false },
        { name: "demo", managed: true },
      ],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: [],
      registered: [],
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId["mkt:teads-plugins"]).toMatchObject({
      kind: "marketplace",
      label: "teads-plugins",
      removable: false,
    });
    expect(byId["mkt:demo"]).toMatchObject({ removable: true });
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

describe("isSourcesFilterActive", () => {
  const rows = buildSourceRows({
    marketplaces: [{ name: "demo" }],
    defaultOrg: "harnesstap-cloud",
    connectedOrgs: ["acme"],
    registered: [{ org: "acme", catalog: "internal" }],
  });
  const defaults = defaultCheckedSourceIds(rows);

  test("is inactive at search-empty all-checked defaults", () => {
    expect(isSourcesFilterActive("", defaults, rows)).toBe(false);
    expect(isSourcesFilterActive("   ", defaults, rows)).toBe(false);
  });

  test("is active when search is non-empty even if checkboxes stay default", () => {
    expect(isSourcesFilterActive("demo", defaults, rows)).toBe(true);
  });

  test("is active when a default-checked source is unchecked", () => {
    expect(isSourcesFilterActive("", ["local"], rows)).toBe(true);
    expect(
      isSourcesFilterActive(
        "",
        defaults.filter((id) => id !== "mkt:demo"),
        rows,
      ),
    ).toBe(true);
  });
});

describe("sourceCheckState", () => {
  const rows = buildSourceRows({
    marketplaces: [{ name: "demo" }],
    defaultOrg: "harnesstap-cloud",
    connectedOrgs: ["acme"],
    registered: [{ org: "acme", catalog: "internal" }],
  });
  const defaults = defaultCheckedSourceIds(rows);

  test("is all when every source is checked", () => {
    expect(sourceCheckState(defaults, rows)).toBe("all");
  });

  test("is none when no source is checked", () => {
    expect(sourceCheckState([], rows)).toBe("none");
  });

  test("is mixed when some sources are checked", () => {
    expect(sourceCheckState(["local"], rows)).toBe("mixed");
  });
});

describe("nextCheckedSourceIds", () => {
  const rows = buildSourceRows({
    marketplaces: [{ name: "demo" }],
    defaultOrg: "harnesstap-cloud",
    connectedOrgs: ["acme"],
    registered: [{ org: "acme", catalog: "internal" }],
  });
  const defaults = defaultCheckedSourceIds(rows);

  test("clears every source when all are checked", () => {
    expect(nextCheckedSourceIds(defaults, rows)).toEqual([]);
  });

  test("reselects every source from none or mixed", () => {
    expect(nextCheckedSourceIds([], rows)).toEqual(defaults);
    expect(nextCheckedSourceIds(["local"], rows)).toEqual(defaults);
  });
});

describe("groupSourceRows", () => {
  test("splits rows into Local, Marketplaces, and Cloud and omits empty sections", () => {
    const rows = buildSourceRows({
      marketplaces: [{ name: "teads-plugins" }, { name: "demo" }],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["acme"],
      registered: [{ org: "acme", catalog: "internal" }],
    });
    expect(groupSourceRows(rows)).toEqual([
      {
        id: "local",
        label: "Local",
        rows: [rows[0]!],
      },
      {
        id: "marketplaces",
        label: "Marketplaces",
        rows: [rows[1]!, rows[2]!],
      },
      {
        id: "cloud",
        label: "Cloud",
        rows: [rows[3]!, rows[4]!, rows[5]!],
      },
    ]);
  });

  test("omits Marketplaces when there are none", () => {
    const rows = buildSourceRows({
      marketplaces: [],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: [],
      registered: [],
    });
    expect(groupSourceRows(rows).map((section) => section.id)).toEqual([
      "local",
      "cloud",
    ]);
  });
});
