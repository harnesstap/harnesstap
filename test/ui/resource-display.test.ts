import { describe, expect, it } from "bun:test";
import {
  AGENTS_MD_DISPLAY_NAME,
  containedFileStem,
  formatOriginDisplayLabel,
  duplicatePluginNames,
  formatResourceDisplayName,
  formatResourceScopeLabel,
  inferContainedFileType,
  packageDirectoryDisplayPath,
  resourceHumanName,
} from "../../src/ui/resource-display.ts";

describe("resource display labels", () => {
  it("uses Agent instructions (AGENTS.md) for the canonical instruction", () => {
    expect(resourceHumanName({ name: "agents-instructions" })).toBe(
      AGENTS_MD_DISPLAY_NAME,
    );
    expect(
      resourceHumanName({ name: "other", source: "AGENTS.md" }),
    ).toBe(AGENTS_MD_DISPLAY_NAME);
    expect(
      resourceHumanName({
        name: "other",
        source: "/Users/me/dev/harnesstap/AGENTS.md",
      }),
    ).toBe(AGENTS_MD_DISPLAY_NAME);
    expect(resourceHumanName({ name: "ship", source: "SKILL.md" })).toBe("ship");
  });

  it("keeps namespace on the human name without changing the stored id", () => {
    expect(
      formatResourceDisplayName({
        name: "agents-instructions",
        namespace: "project default",
      }),
    ).toBe(`${AGENTS_MD_DISPLAY_NAME}@project default`);
    expect(formatResourceDisplayName({ name: "api" })).toBe("api");
  });

  it("omits marketplace on a unique plugin and adds it when names collide", () => {
    expect(
      formatResourceDisplayName({
        name: "ripwire",
        type: "plugin",
        origin_ref: "ripwire@claude-plugins-official",
      }),
    ).toBe("ripwire");
    expect(
      formatResourceDisplayName(
        {
          name: "superpowers",
          type: "plugin",
          origin_ref: "superpowers@claude-plugins-official",
        },
        { disambiguatePlugin: true },
      ),
    ).toBe("superpowers@claude-plugins-official");
    expect(
      duplicatePluginNames([
        { name: "ripwire", type: "plugin" },
        { name: "superpowers", type: "plugin" },
        { name: "superpowers", type: "plugin" },
        { name: "ship", type: "skill" },
      ]),
    ).toEqual(new Set(["superpowers"]));
    expect(
      duplicatePluginNames([
        { name: "superpowers", type: "plugin", listKind: "plugin-package" },
        { name: "superpowers", type: "plugin" },
      ]),
    ).toEqual(new Set());
  });

  it("labels empty namespace as global", () => {
    expect(formatResourceScopeLabel("")).toBe("global");
    expect(formatResourceScopeLabel(null)).toBe("global");
    expect(formatResourceScopeLabel("project default")).toBe("project default");
  });

  it("formats origin like resource details", () => {
    expect(formatOriginDisplayLabel("local_snapshot")).toBe("Local");
    expect(
      formatOriginDisplayLabel(
        "local_snapshot",
        "/Users/christophe.oudar/dev/opensource/harnesstap",
      ),
    ).toBe("Local (/Users/christophe.oudar/dev/opensource/harnesstap)");
    expect(
      formatOriginDisplayLabel("marketplace_link", "demo@team-mkt", {
        includeRef: false,
      }),
    ).toBe("Marketplace");
  });

  it("shows the package directory for SKILL.md and plugin.json", () => {
    expect(
      packageDirectoryDisplayPath(
        "/Users/christophe.oudar/.claude/skills/archify/SKILL.md",
      ),
    ).toBe("/Users/christophe.oudar/.claude/skills/archify");
    expect(packageDirectoryDisplayPath("skills/archify/SKILL.md")).toBe(
      "skills/archify",
    );
    expect(
      packageDirectoryDisplayPath("/home/ada/.cursor/plugins/demo/plugin.json"),
    ).toBe("/home/ada/.cursor/plugins/demo");
    expect(packageDirectoryDisplayPath("agents/devx.md")).toBe("agents/devx.md");
  });

  it("infers contained file types from plugin tree paths", () => {
    expect(inferContainedFileType("skills/team/SKILL.md")).toBe("skill");
    expect(inferContainedFileType("agents/reviewer.md")).toBe("agent");
    expect(inferContainedFileType(".cursor-plugin/plugin.json")).toBe("file");
    expect(containedFileStem("rules/review.mdc")).toBe("review");
  });
});
