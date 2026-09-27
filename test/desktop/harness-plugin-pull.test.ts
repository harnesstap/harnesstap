import { describe, expect, it } from "bun:test";
import { AgentApiError } from "../../apps/desktop/src/lib/api/http.ts";
import type {
  PluginVersionPullResult,
  PluginVersionSwitchResult,
  ResourceSyncResult,
} from "../../apps/desktop/src/lib/api/resource-mutate.ts";
import type { HarnessResourceRow } from "../../apps/desktop/src/lib/harness-inventory.ts";
import {
  groupHarnessPluginPullReport,
  harnessPluginPullPills,
  harnessPluginPullProgressCopy,
  harnessPluginPullTargets,
  latestPulledVersion,
  makeHarnessPluginPullReport,
  pullLatestHarnessPlugins,
  syncChangeLines,
  versionChangeLine,
} from "../../apps/desktop/src/lib/harness-plugin-pull.ts";

function row(
  name: string,
  extra: Partial<Pick<HarnessResourceRow, "id" | "origin_ref" | "source">> = {},
): HarnessResourceRow {
  return {
    id: extra.id ?? `plugin-${name}`,
    type: "plugin",
    name,
    description: "",
    source: extra.source ?? `~/.cursor/plugins/${name}`,
    origin_kind: "marketplace_link",
    namespace: null,
    origin_ref: extra.origin_ref ?? `${name}@cursor-public`,
  };
}

function pullInfo(
  current: string | null,
  advertised: string | null,
  versions: string[] = [],
): PluginVersionPullResult {
  const names = versions.length > 0
    ? versions
    : [advertised, current].filter((value): value is string => Boolean(value));
  return {
    current_version: current,
    advertised_version: advertised,
    available_versions: names.map((version) => ({
      version,
      path: `/cache/${version}`,
      manifest_version: version,
      current: version === current,
      advertised: version === advertised,
    })),
  };
}

function emptySync(
  updated: ResourceSyncResult["updated"] = [],
): ResourceSyncResult {
  return {
    dry_run: false,
    checked: updated.length,
    updated,
    unchanged: [],
    skipped: [],
    stale: [],
  };
}

function switched(
  version: string,
  updated: ResourceSyncResult["updated"] = [],
): PluginVersionSwitchResult {
  return {
    version,
    install_path: `/cache/${version}`,
    sync: emptySync(updated),
  };
}

describe("harnessPluginPullTargets", () => {
  it("keeps unique selectors and skips rows without an id or origin ref", () => {
    const targets = harnessPluginPullTargets([
      row("slack"),
      row("slack", { id: "plugin-slack", source: "~/.claude/plugins/slack" }),
      row("ghost", { id: "", origin_ref: "" }),
      row("browse", { id: "", origin_ref: "browse@cursor-public" }),
    ]);
    expect(targets.map((target) => target.selector)).toEqual([
      "plugin-slack",
      "browse@cursor-public",
    ]);
    expect(targets.map((target) => target.name)).toEqual(["slack", "browse"]);
  });
});

describe("latestPulledVersion", () => {
  it("prefers advertised_version over cache order", () => {
    expect(
      latestPulledVersion({
        advertised_version: "6.3.0",
        available_versions: [
          {
            version: "6.4.0",
            path: "/cache/6.4.0",
            manifest_version: "6.4.0",
            current: false,
            advertised: false,
          },
          {
            version: "6.3.0",
            path: "/cache/6.3.0",
            manifest_version: "6.3.0",
            current: false,
            advertised: true,
          },
        ],
      }),
    ).toBe("6.3.0");
  });

  it("falls back to the advertised flag then the first available version", () => {
    expect(
      latestPulledVersion({
        advertised_version: null,
        available_versions: [
          {
            version: "1.2.0",
            path: "/cache/1.2.0",
            manifest_version: "1.2.0",
            current: false,
            advertised: true,
          },
        ],
      }),
    ).toBe("1.2.0");
    expect(
      latestPulledVersion({
        advertised_version: "  ",
        available_versions: [
          {
            version: "0.9.0",
            path: "/cache/0.9.0",
            manifest_version: null,
            current: true,
            advertised: false,
          },
        ],
      }),
    ).toBe("0.9.0");
  });
});

describe("syncChangeLines and versionChangeLine", () => {
  it("omits plugin pin rows and uses singular type units", () => {
    expect(
      syncChangeLines([
        { id: "p1", type: "plugin", name: "slack", namespace: null },
        { id: "s1", type: "skill", name: "draft", namespace: "slack" },
        { id: "m1", type: "mcp_server", name: "slack", namespace: "slack" },
      ]),
    ).toEqual(["skill draft", "MCP slack"]);
  });

  it("formats version changes without an em dash", () => {
    expect(versionChangeLine("1.0.0", "1.1.0")).toBe("1.0.0 → 1.1.0");
    expect(versionChangeLine(null, "1.1.0")).toBe("now 1.1.0");
    expect(versionChangeLine("1.0.0", "1.0.0")).toBe("1.0.0");
  });
});

describe("pullLatestHarnessPlugins", () => {
  it("switches outdated plugins, skips current heads, and records failures", async () => {
    const pulled: Record<string, PluginVersionPullResult> = {
      slack: pullInfo("1.0.0", "1.2.0"),
      browse: pullInfo("2.0.0", "2.0.0"),
    };
    const report = await pullLatestHarnessPlugins(
      "http://agent",
      "token",
      [
        { selector: "slack", name: "slack" },
        { selector: "browse", name: "browse" },
        { selector: "broken", name: "broken" },
      ],
      undefined,
      {
        pull: async (_base, _token, selector) => {
          if (selector === "broken") {
            throw new AgentApiError("Marketplace acme is not installed", 400, "source_unavailable");
          }
          const info = pulled[selector];
          if (!info) {
            throw new Error(`missing fixture ${selector}`);
          }
          return info;
        },
        switchVersion: async (_base, _token, selector, version) => {
          expect(selector).toBe("slack");
          expect(version).toBe("1.2.0");
          return switched(version, [
            { id: "s1", type: "skill", name: "draft", namespace: "slack" },
          ]);
        },
      },
    );

    expect(report.summary).toEqual({ updated: 1, current: 1, failed: 1 });
    expect(report.pills.map((pill) => pill.label)).toEqual([
      "1 updated",
      "1 current",
      "1 failed",
    ]);
    const grouped = groupHarnessPluginPullReport(report);
    expect(grouped.updated[0]?.changes).toEqual(["skill draft"]);
    expect(grouped.updated[0]?.toVersion).toBe("1.2.0");
    expect(grouped.current[0]?.name).toBe("browse");
    expect(grouped.failed[0]?.message).toBe("Marketplace acme is not installed");
  });

  it("treats a successful pull with no newer version as current", async () => {
    const report = await pullLatestHarnessPlugins(
      "http://agent",
      null,
      [{ selector: "pin", name: "pin" }],
      undefined,
      {
        pull: async () => pullInfo("3.1.0", "3.1.0"),
        switchVersion: async () => {
          throw new Error("should not switch");
        },
      },
    );
    expect(report.summary).toEqual({ updated: 0, current: 1, failed: 0 });
    expect(harnessPluginPullPills(report.summary)).toEqual([
      { label: "up to date", tone: "ok" },
    ]);
  });
});

describe("makeHarnessPluginPullReport", () => {
  it("groups an empty run as no plugins", () => {
    const report = makeHarnessPluginPullReport([]);
    expect(report.pills).toEqual([]);
    expect(groupHarnessPluginPullReport(report)).toEqual({
      updated: [],
      current: [],
      failed: [],
    });
    expect(harnessPluginPullProgressCopy(0, 3)).toBe("Pulling 1 of 3…");
    expect(harnessPluginPullProgressCopy(2, 3)).toBe("Pulling 3 of 3…");
    expect(harnessPluginPullProgressCopy(0, 0)).toBe("Pulling…");
  });
});
