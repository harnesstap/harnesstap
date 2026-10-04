import { describe, expect, test } from "bun:test";
import {
  buildSourceRows,
  defaultCheckedSourceIds,
  groupSourceRows,
  isSourcesFilterActive,
  nextCheckedSourceIds,
  nextCheckedSourceIdsForChild,
  sourceCheckState,
  sourceChildChecked,
} from "../../apps/desktop/src/lib/sources-sidebar.ts";

describe("buildSourceRows", () => {
  test("orders marketplaces, default org, other orgs, then registered catalogs", () => {
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
      "mkt:teads",
      "mkt:demo",
      "org:harnesstap-cloud",
      "org:acme",
      "org:other",
      "cat:acme/internal",
      "cat:acme/default",
    ]);
    expect(rows.map((row) => row.kind)).toEqual([
      "marketplace",
      "marketplace",
      "cloud-org",
      "cloud-org",
      "cloud-org",
      "cloud-catalog",
      "cloud-catalog",
    ]);
    expect(rows.map((row) => row.label)).toEqual([
      "teads",
      "demo",
      "harnesstap-cloud",
      "acme",
      "other",
      "acme/internal",
      "acme/default",
    ]);
  });

  test("default org is not removable and forbids disconnect", () => {
    const rows = buildSourceRows({
      marketplaces: [{ name: "demo" }],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["acme"],
      registered: [{ org: "acme", catalog: "internal" }],
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
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
    expect(isSourcesFilterActive("", ["org:acme"], rows)).toBe(true);
    expect(
      isSourcesFilterActive(
        "",
        defaults.filter((id) => id !== "mkt:demo"),
        rows,
      ),
    ).toBe(true);
  });

  test("is active when Not in my library is checked", () => {
    expect(isSourcesFilterActive("", defaults, rows, false)).toBe(false);
    expect(isSourcesFilterActive("", defaults, rows, true)).toBe(true);
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
    expect(sourceCheckState(["mkt:demo"], rows)).toBe("mixed");
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
    expect(nextCheckedSourceIds(["mkt:demo"], rows)).toEqual(defaults);
  });
});

describe("sourceChildChecked", () => {
  test("hides child checks while All is selected", () => {
    expect(sourceChildChecked("all", true)).toBe(false);
    expect(sourceChildChecked("mixed", true)).toBe(true);
    expect(sourceChildChecked("none", false)).toBe(false);
  });
});

describe("nextCheckedSourceIdsForChild", () => {
  const rows = buildSourceRows({
    marketplaces: [{ name: "demo" }],
    defaultOrg: "harnesstap-cloud",
    connectedOrgs: ["acme"],
    registered: [{ org: "acme", catalog: "internal" }],
  });
  const defaults = defaultCheckedSourceIds(rows);

  test("starts a specific selection from All", () => {
    expect(nextCheckedSourceIdsForChild(defaults, rows, "mkt:demo")).toEqual([
      "mkt:demo",
    ]);
  });

  test("toggles a child when selection is already mixed", () => {
    expect(nextCheckedSourceIdsForChild(["org:acme"], rows, "mkt:demo")).toEqual([
      "mkt:demo",
      "org:acme",
    ]);
    expect(nextCheckedSourceIdsForChild(["org:acme", "mkt:demo"], rows, "org:acme")).toEqual([
      "mkt:demo",
    ]);
  });
});

describe("groupSourceRows", () => {
  test("splits rows into Marketplaces and Cloud and omits empty sections", () => {
    const rows = buildSourceRows({
      marketplaces: [{ name: "teads-plugins" }, { name: "demo" }],
      defaultOrg: "harnesstap-cloud",
      connectedOrgs: ["acme"],
      registered: [{ org: "acme", catalog: "internal" }],
    });
    expect(groupSourceRows(rows)).toEqual([
      {
        id: "marketplaces",
        label: "Marketplaces",
        rows: [rows[0]!, rows[1]!],
      },
      {
        id: "cloud",
        label: "Cloud",
        rows: [rows[2]!, rows[3]!, rows[4]!],
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
      "cloud",
    ]);
  });
});
