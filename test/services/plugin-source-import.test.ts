import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanPluginSource } from "../../src/services/plugin-source-import.ts";

const fixtureRoot = join(import.meta.dirname, "../fixtures/plugin-import");

describe("plugin-source-import service", () => {
  it("scans a cursor plugin root into canonical resources", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "cursor-team-kit"));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source_kind: "cursor-plugin",
      source_label: "cursor-team-kit",
      plugin_name: "cursor-team-kit",
      plugin_version: "1.4.0",
      metadata: {
        manifest_path: expect.stringContaining(".cursor-plugin/plugin.json"),
        source_plugin_kind: "cursor-plugin",
      },
    });

    expect(entries[0]?.resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["skill", "agent", "rule"]),
    );
    expect(entries[0]?.resources.find((resource) => resource.type === "skill"))
      .toMatchObject({
        name: "team",
        description: "Team review workflow",
        metadata: {
          imported_from: {
            relative_path: "skills/team/SKILL.md",
            source_kind: "cursor-plugin",
            plugin_name: "cursor-team-kit",
          },
        },
      });
  });

  it("expands a marketplace manifest into multiple plugin imports", async () => {
    const entries = await scanPluginSource(
      join(fixtureRoot, "marketplace/.cursor-plugin/marketplace.json"),
    );

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.plugin_name)).toEqual([
      "cursor-team-kit",
      "release-guardian",
    ]);
    expect(entries.map((entry) => entry.source_kind)).toEqual([
      "marketplace",
      "marketplace",
    ]);
    expect(entries[0]?.source_label).toBe("team-marketplace");
    expect(entries[1]).toMatchObject({
      metadata: {
        marketplace_name: "team-marketplace",
        source_plugin_kind: "claude-plugin",
      },
    });
    expect(
      entries[1]?.resources.map((resource) => ({
        type: resource.type,
        name: resource.name,
      })),
    ).toEqual(
      expect.arrayContaining([
        { type: "agent", name: "release-reviewer" },
        { type: "rule", name: "review" },
      ]),
    );
  });

  it("scans a claude plugin root directly", async () => {
    const entries = await scanPluginSource(
      join(fixtureRoot, "marketplace/plugins/release-guardian"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source_kind: "claude-plugin",
      source_label: "release-guardian",
      plugin_name: "release-guardian",
      plugin_version: "0.6.0",
      metadata: {
        source_plugin_kind: "claude-plugin",
      },
    });
  });

  it("keeps cursor rule always_apply false when metadata omits alwaysApply", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "cursor-team-kit"));
    const advisoryRule = entries[0]?.resources.find(
      (resource) => resource.type === "rule" && resource.name === "advisory",
    );

    expect(advisoryRule).toMatchObject({
      metadata: {
        always_apply: false,
        globs: [],
      },
    });
  });

  it("keeps alwaysApply plugin rules as canonical rule resources", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "cursor-team-kit"));
    const globalReviewRule = entries[0]?.resources.find(
      (resource) => resource.name === "global-review",
    );

    expect(globalReviewRule).toMatchObject({
      type: "rule",
      metadata: {
        always_apply: true,
        globs: [],
      },
    });
  });

  it("fails when a plugin manifest is malformed", async () => {
    const brokenRoot = join(fixtureRoot, "broken-plugin");
    await expect(scanPluginSource(brokenRoot)).rejects.toThrow(
      /Malformed plugin manifest/,
    );
  });
});
