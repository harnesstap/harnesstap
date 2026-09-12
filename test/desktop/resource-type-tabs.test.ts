import { describe, expect, it } from "bun:test";
import {
  ALL_RESOURCE_TYPE_TAB,
  countResourceTypeTabs,
  resolveResourceTypeTab,
  RESOURCE_TYPE_TAB_ORDER,
  resourceTypeTabGlyph,
  resourceTypeTabItemCount,
  resourceTypeTabLabel,
  resourceTypeTabPillsText,
  resourceTypeTabTooltip,
  visibleResourceTypeTabs,
} from "../../apps/desktop/src/lib/resource-type-tabs.ts";
import { resourceTypeGlyph } from "../../apps/desktop/src/lib/type-glyph.ts";

describe("resourceTypeTabLabel", () => {
  it("uses short Desktop labels", () => {
    expect(resourceTypeTabLabel("all")).toBe("All");
    expect(resourceTypeTabLabel("plugin")).toBe("Plugins");
    expect(resourceTypeTabLabel("mcp_server")).toBe("MCPs");
    expect(resourceTypeTabLabel("skill")).toBe("Skills");
    expect(resourceTypeTabLabel("agent")).toBe("Subagents");
    expect(resourceTypeTabLabel("model_config")).toBe("Model config");
    expect(resourceTypeTabLabel("plugin_ref")).toBe("Plugin refs");
  });
});

describe("visibleResourceTypeTabs", () => {
  it("hides empty types and All when only one type is present", () => {
    const counts = countResourceTypeTabs(["skill", "skill"]);
    expect(visibleResourceTypeTabs(counts)).toEqual(["skill"]);
  });

  it("shows All only when two or more types are present", () => {
    const counts = countResourceTypeTabs(["skill", "plugin", "skill"]);
    expect(visibleResourceTypeTabs(counts)).toEqual([
      ALL_RESOURCE_TYPE_TAB,
      "plugin",
      "skill",
    ]);
  });

  it("follows designer order and appends unknown types last", () => {
    const counts = countResourceTypeTabs([
      "instruction",
      "custom_kind",
      "plugin",
      "mcp_server",
    ]);
    expect(visibleResourceTypeTabs(counts)).toEqual([
      ALL_RESOURCE_TYPE_TAB,
      "plugin",
      "mcp_server",
      "instruction",
      "custom_kind",
    ]);
  });

  it("omits All when includeAll is false", () => {
    const counts = countResourceTypeTabs(["skill", "plugin", "skill"]);
    expect(visibleResourceTypeTabs(counts, { includeAll: false })).toEqual([
      "plugin",
      "skill",
    ]);
  });
});

describe("resourceTypeTabPillsText", () => {
  it("puts count before the type text", () => {
    const mixed = countResourceTypeTabs(["skill", "plugin", "plugin"]);
    expect(resourceTypeTabPillsText("skill", mixed)).toBe("1 Skills");
    expect(resourceTypeTabPillsText("plugin", mixed)).toBe("2 Plugins");
    expect(resourceTypeTabPillsText("all", mixed)).toBe("3 All");

    const one = countResourceTypeTabs(["skill"]);
    expect(resourceTypeTabPillsText("skill", one)).toBe("1 Skills");
  });
});

describe("resource type tab aria-labels", () => {
  it("uses All as the total across types", () => {
    const mixed = countResourceTypeTabs(["skill", "skill", "plugin"]);
    expect(resourceTypeTabItemCount("all", mixed)).toBe(3);
    expect(resourceTypeTabItemCount("skill", mixed)).toBe(2);
    expect(resourceTypeTabTooltip("all", mixed)).toBe("3 resources");
  });

  it("uses short pluralized copy", () => {
    const mixed = countResourceTypeTabs([
      "skill",
      "plugin",
      "plugin",
      "plugin",
      "mcp_server",
      "agent",
      "rule",
      "command",
      "hook",
      "instruction",
    ]);
    expect(resourceTypeTabTooltip("skill", mixed)).toBe("1 skill");
    expect(resourceTypeTabTooltip("plugin", mixed)).toBe("3 plugins");
    expect(resourceTypeTabTooltip("mcp_server", mixed)).toBe("1 MCP");
    expect(resourceTypeTabTooltip("agent", mixed)).toBe("1 subagent");
    expect(resourceTypeTabTooltip("rule", mixed)).toBe("1 rule");
    expect(resourceTypeTabTooltip("command", mixed)).toBe("1 command");
    expect(resourceTypeTabTooltip("hook", mixed)).toBe("1 hook");
    expect(resourceTypeTabTooltip("instruction", mixed)).toBe("1 instruction");
    expect(resourceTypeTabTooltip("all", mixed)).toBe("10 resources");

    const skills = countResourceTypeTabs(["skill", "skill", "skill"]);
    expect(resourceTypeTabTooltip("skill", skills)).toBe("3 skills");
    expect(resourceTypeTabTooltip("all", new Map([["skill", 0]]))).toBe("All");
  });
});

describe("resolveResourceTypeTab", () => {
  it("falls back to All when the selected type is empty", () => {
    const counts = countResourceTypeTabs(["skill", "plugin"]);
    expect(resolveResourceTypeTab("rule", counts)).toBeNull();
    expect(resolveResourceTypeTab("skill", counts)).toBe("skill");
    expect(resolveResourceTypeTab(null, counts)).toBeNull();
    expect(resolveResourceTypeTab(ALL_RESOURCE_TYPE_TAB, counts)).toBeNull();
  });

  it("keeps a valid type and otherwise selects the first present type when All is hidden", () => {
    const counts = countResourceTypeTabs(["skill", "plugin"]);
    const noAll = { includeAll: false } as const;
    expect(resolveResourceTypeTab("skill", counts, noAll)).toBe("skill");
    expect(resolveResourceTypeTab("plugin", counts, noAll)).toBe("plugin");
    expect(resolveResourceTypeTab("rule", counts, noAll)).toBe("plugin");
    expect(resolveResourceTypeTab(null, counts, noAll)).toBe("plugin");
    expect(resolveResourceTypeTab(ALL_RESOURCE_TYPE_TAB, counts, noAll)).toBe(
      "plugin",
    );
  });
});

describe("typed row glyphs", () => {
  it("keeps Sparkles as the skill glyph only on tabs and rows", () => {
    expect(resourceTypeTabGlyph(ALL_RESOURCE_TYPE_TAB)).toBe("layout-grid");
    expect(resourceTypeTabGlyph("skill")).toBe("sparkles");
    expect(resourceTypeGlyph("skill")).toBe("sparkles");
    expect(resourceTypeTabGlyph("plugin")).toBe("layers");
    expect(resourceTypeTabGlyph("plugin_ref")).toBe("package");
    expect(resourceTypeTabGlyph("plugin_pin")).toBe("package");
    expect(resourceTypeTabGlyph("instruction")).toBe("file-text");
    expect(resourceTypeGlyph("agent")).toBe("bot");
    expect(resourceTypeGlyph("mcp_server")).not.toBe("sparkles");

    for (const type of RESOURCE_TYPE_TAB_ORDER) {
      if (type === "skill") {
        expect(resourceTypeTabGlyph(type)).toBe("sparkles");
        continue;
      }
      expect(resourceTypeTabGlyph(type)).not.toBe("sparkles");
      expect(resourceTypeGlyph(type)).not.toBe("sparkles");
    }
  });
});
