import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  groupFileChangesByResource,
  type ContentsDiffItem,
} from "../../apps/desktop/src/lib/contents-diff";
import {
  cursorAnchorStyle,
  formatHoverPath,
  hoverModelFromContentsDiffItem,
  hoverModelFromFileChangeChild,
  hoverModelFromFileChangeGroup,
  hoverModelFromLibraryResource,
  hoverModelFromProfileResource,
  resourceHoverCardHasContent,
} from "../../apps/desktop/src/lib/resource-hover";
import type { LibraryResource, ProfileContentsResource } from "../../apps/desktop/src/lib/types";

const skill: LibraryResource = {
  id: "skill:ship",
  name: "ship",
  type: "skill",
  namespace: null,
  description: "Ship it",
  source: "/Users/me/.claude/skills/ship/SKILL.md",
  origin_kind: "marketplace_link",
};

describe("resource hover model", () => {
  it("builds a library resource model with path, origin, and related harnesses", () => {
    expect(hoverModelFromLibraryResource(skill)).toEqual({
      type: "skill",
      name: "ship",
      path: "/Users/me/.claude/skills/ship/SKILL.md",
      originKind: "marketplace_link",
      harnessIds: ["claude-code", "cursor"],
      extra: [],
    });
  });

  it("uses namespace display name and omits empty path/origin", () => {
    const resource: LibraryResource = {
      id: "rule:x",
      name: "x",
      type: "rule",
      namespace: "acme",
      description: null,
    };
    expect(hoverModelFromLibraryResource(resource)).toEqual({
      type: "rule",
      name: "x@acme",
      harnessIds: ["claude-code", "cursor"],
      extra: [],
    });
  });

  it("builds a profile resource model from name/type/source", () => {
    const resource: ProfileContentsResource = {
      type: "command",
      name: "deploy",
      source: "/Users/me/.claude/commands/deploy.md",
    };
    expect(hoverModelFromProfileResource(resource)).toEqual({
      type: "command",
      name: "deploy",
      path: "/Users/me/.claude/commands/deploy.md",
      harnessIds: ["claude-code"],
      extra: [],
    });
  });

  it("builds a contents-diff model from icon type, label, and path", () => {
    const item: ContentsDiffItem = {
      key: "resource:command:deploy",
      kind: "added",
      category: "resource",
      iconType: "command",
      label: "deploy",
      path: "/Users/me/.claude/commands/deploy.md",
    };
    expect(hoverModelFromContentsDiffItem(item)).toEqual({
      type: "command",
      name: "deploy",
      path: "/Users/me/.claude/commands/deploy.md",
      harnessIds: ["claude-code"],
      extra: [],
    });
  });

  it("omits empty path from a contents-diff hover model", () => {
    const item: ContentsDiffItem = {
      key: "pin:work@1",
      kind: "unchanged",
      category: "plugin_pin",
      iconType: "plugin_pin",
      label: "work@1",
    };
    expect(hoverModelFromContentsDiffItem(item)).toEqual({
      type: "plugin_pin",
      name: "work@1",
      harnessIds: ["claude-code", "cursor"],
      extra: [],
    });
  });

  it("builds a file-change parent model with destinations extra and first path", () => {
    const [group] = groupFileChangesByResource([
      {
        path: ".cursor/skills/ship/SKILL.md",
        type: "deleted",
        platform: "cursor",
        resource: { type: "skill", name: "ship", origin_kind: "marketplace_link" },
      },
      {
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        platform: "claude-code",
        resource: { type: "skill", name: "ship", origin_kind: "marketplace_link" },
      },
    ]);
    expect(hoverModelFromFileChangeGroup(group)).toEqual({
      type: "skill",
      name: "ship",
      path: ".cursor/skills/ship/SKILL.md",
      originKind: "marketplace_link",
      harnessIds: ["claude-code", "cursor"],
      extra: [{ kind: "destinations", text: "add → Claude Code, Cursor" }],
    });
  });

  it("infers MCP type for a group with no resource", () => {
    const [group] = groupFileChangesByResource([
      { path: ".cursor/mcp.json", type: "modified", platform: "cursor" },
    ]);
    expect(hoverModelFromFileChangeGroup(group)).toEqual({
      type: "mcp_server",
      name: ".cursor/mcp.json",
      path: ".cursor/mcp.json",
      harnessIds: ["cursor"],
      extra: [{ kind: "destinations", text: "update → Cursor" }],
    });
  });

  it("builds a child model with path only plus platform harness", () => {
    expect(
      hoverModelFromFileChangeChild({
        path: ".claude/skills/ship/SKILL.md",
        type: "deleted",
        platform: "claude-code",
      }),
    ).toEqual({
      name: ".claude/skills/ship/SKILL.md",
      path: ".claude/skills/ship/SKILL.md",
      harnessIds: ["claude-code"],
      extra: [],
    });
  });

  it("treats name-only models as empty hover cards", () => {
    expect(
      resourceHoverCardHasContent({
        name: "orphan",
        harnessIds: [],
        extra: [],
      }),
    ).toBe(false);
    expect(
      resourceHoverCardHasContent({
        name: "ship",
        type: "skill",
        harnessIds: [],
        extra: [],
      }),
    ).toBe(true);
  });

  it("inserts break opportunities after slashes", () => {
    expect(formatHoverPath("a/b/c")).toBe("a/\u200bb/\u200bc");
  });

  it("places a zero-size fixed anchor at the pointer", () => {
    expect(cursorAnchorStyle({ x: 140, y: 88 })).toEqual({
      position: "fixed",
      left: 140,
      top: 88,
      width: 0,
      height: 0,
      pointerEvents: "none",
    });
  });
});

describe("resource hover card chrome", () => {
  const hoverCardSource = readFileSync(
    join(
      import.meta.dir,
      "../../apps/desktop/src/components/ui/resource-hover-card.tsx",
    ),
    "utf8",
  );

  it("anchors the card to a pointer-sized trigger, not the row box", () => {
    expect(hoverCardSource).toContain("cursorAnchorStyle");
    expect(hoverCardSource).toContain("resource-hover-cursor-anchor");
    expect(hoverCardSource).not.toContain("alignOffset");
    expect(hoverCardSource).not.toContain("cursorAlignOffset");
  });

  it("closes immediately when leaving a row so prior cards cannot linger", () => {
    expect(hoverCardSource).not.toContain("CLOSE_DELAY");
    expect(hoverCardSource).not.toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{\s*setOpen\(false\)/);
  });
});
