import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanPluginSource } from "../../src/services/plugin-source-import.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const fixtureRoot = join(import.meta.dirname, "../fixtures/plugin-import");
const superpowersFixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

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

  it("scans a codex plugin root", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "codex-ponytail"));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata.source_plugin_kind).toBe("codex-plugin");
    expect(entries[0]?.resources.some((r) => r.type === "skill")).toBe(true);
  });

  it("scans a copilot plugin root", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "copilot-ponytail"));

    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata.source_plugin_kind).toBe("copilot-plugin");
    expect(entries[0]?.resources.some((r) => r.type === "skill")).toBe(true);
  });

  it("imports hooks from all plugin manifests at repo root", async () => {
    const entries = await scanPluginSource(superpowersFixture);
    const hooks = entries.flatMap((e) => e.resources).filter((r) => r.type === "hook");
    const sources = hooks.map((h) => h.source);
    expect(sources).toContain("hooks/hooks-cursor.json");
    expect(sources).toContain("hooks/hooks.json");
  });

  it("imports TOML commands and JSON hooks from plugin manifest pointers", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "claude-ponytail"));
    const types = entries[0]?.resources.map((r) => r.type) ?? [];
    expect(types).toContain("command");
    expect(types).toContain("hook");
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

  it("fails when a parsed plugin manifest is missing a usable name", async () => {
    await expect(
      scanPluginSource(join(fixtureRoot, "missing-name-plugin")),
    ).rejects.toThrow(/Invalid plugin manifest/);
  });

  it("fails when a parsed plugin manifest has a non-string version", async () => {
    await expect(
      scanPluginSource(join(fixtureRoot, "invalid-version-plugin")),
    ).rejects.toThrow(/Invalid plugin manifest/);
  });

  it("fails clearly when marketplace plugins is not an array", async () => {
    await expect(
      scanPluginSource(
        join(fixtureRoot, "invalid-marketplace/.cursor-plugin/marketplace.json"),
      ),
    ).rejects.toThrow(/Invalid marketplace manifest/);
  });

  it("fails clearly when a marketplace entry path is not a string", async () => {
    await expect(
      scanPluginSource(
        join(
          fixtureRoot,
          "bad-entry-marketplace/.cursor-plugin/marketplace.json",
        ),
      ),
    ).rejects.toThrow(/Marketplace entry path must be a string/);
  });

  it("fails when marketplace name is missing a usable string", async () => {
    await expect(
      scanPluginSource(
        join(
          fixtureRoot,
          "invalid-marketplace-name/.cursor-plugin/marketplace.json",
        ),
      ),
    ).rejects.toThrow(/Invalid marketplace manifest/);
  });

  it("trims marketplace entry paths before resolving them", async () => {
    const entries = await scanPluginSource(
      join(fixtureRoot, "whitespace-marketplace/.cursor-plugin/marketplace.json"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source_kind: "marketplace",
      source_label: "whitespace-marketplace",
      plugin_name: "cursor-team-kit",
    });
  });

  it("normalizes backslash-separated marketplace entry paths before resolving them", async () => {
    const entries = await scanPluginSource(
      join(fixtureRoot, "backslash-marketplace/.cursor-plugin/marketplace.json"),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source_kind: "marketplace",
      source_label: "backslash-marketplace",
      plugin_name: "cursor-team-kit",
    });
  });

  it("fails when a plugin resource starts with malformed frontmatter", async () => {
    const pluginRoot = createTempDir("plugin-source-bad-frontmatter");

    try {
      writeTextFile(
        join(pluginRoot, ".cursor-plugin/plugin.json"),
        JSON.stringify({ name: "broken-frontmatter-plugin", version: "1.0.0" }),
      );
      writeTextFile(
        join(pluginRoot, "skills/broken/SKILL.md"),
        "----\n# Looks like frontmatter but is malformed\n",
      );

      await expect(scanPluginSource(pluginRoot)).rejects.toThrow(
        /Malformed resource frontmatter/,
      );
    } finally {
      cleanupDir(pluginRoot);
    }
  });

  it("captures claude agent frontmatter options in canonical metadata", async () => {
    const pluginRoot = createTempDir("plugin-source-claude-agent");

    try {
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ name: "release-guardian", version: "0.6.0" }),
      );
      writeTextFile(
        join(pluginRoot, "agents/release-reviewer.md"),
        [
          "---",
          "name: release-reviewer",
          "description: Release review specialist",
          "model: claude-sonnet-4-5",
          "reasoning_effort: high",
          "sandbox_mode: workspace-write",
          "---",
          "",
          "# Release Reviewer",
          "",
          "Check release notes, migration steps, and rollback safety.",
        ].join("\n"),
      );

      const entries = await scanPluginSource(pluginRoot);
      const agent = entries[0]?.resources.find((resource) => resource.type === "agent");

      expect(agent).toMatchObject({
        name: "release-reviewer",
        description: "Release review specialist",
        content:
          "# Release Reviewer\n\nCheck release notes, migration steps, and rollback safety.",
        metadata: {
          model: "claude-sonnet-4-5",
          reasoning_effort: "high",
          sandbox_mode: "workspace-write",
          wire_format: "markdown-frontmatter",
        },
      });
    } finally {
      cleanupDir(pluginRoot);
    }
  });

  it("imports Codex agent TOML from plugin agents/", async () => {
    const pluginRoot = createTempDir("plugin-source-codex-agent");

    try {
      writeTextFile(join(pluginRoot, ".codex-plugin", "plugin.json"), '{"name":"codex-pack"}');
      writeTextFile(
        join(pluginRoot, "agents", "api-designer.toml"),
        `name = "api-designer"
description = "API design specialist"
developer_instructions = "Design contracts."
`,
      );

      const entries = await scanPluginSource(pluginRoot);
      const agent = entries[0]?.resources.find((resource) => resource.type === "agent");

      expect(agent).toMatchObject({
        name: "api-designer",
        description: "API design specialist",
        content: "Design contracts.",
        metadata: { wire_format: "codex-toml" },
      });
    } finally {
      cleanupDir(pluginRoot);
    }
  });

  it("scans skills from manifest skills pointer (impeccable-style layout)", async () => {
    const entries = await scanPluginSource(join(fixtureRoot, "impeccable-layout"));
    expect(entries).toHaveLength(1);
    const skill = entries[0]?.resources.find((r) => r.type === "skill");
    expect(skill?.name).toBe("impeccable");
    expect(skill?.source).toBe(".claude/skills/impeccable/SKILL.md");
  });

  it("accepts marketplace entry source as alias for path", async () => {
    const entries = await scanPluginSource(
      join(fixtureRoot, "impeccable-layout/.claude-plugin/marketplace.json"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.plugin_name).toBe("impeccable-fixture");
    expect(entries[0]?.resources.some((r) => r.type === "hook")).toBe(true);
  });

  it("rejects imported agent names that escape the target directory", async () => {
    const pluginRoot = createTempDir("plugin-source-agent-traversal");

    try {
      writeTextFile(
        join(pluginRoot, ".claude-plugin/plugin.json"),
        JSON.stringify({ name: "escape-plugin", version: "1.0.0" }),
      );
      writeTextFile(
        join(pluginRoot, "agents/escape.md"),
        [
          "---",
          "name: ../CLAUDE",
          "description: Attempted traversal",
          "---",
          "",
          "# Escape",
        ].join("\n"),
      );

      await expect(scanPluginSource(pluginRoot)).rejects.toThrow(
        /Invalid imported resource name/,
      );
    } finally {
      cleanupDir(pluginRoot);
    }
  });
});
