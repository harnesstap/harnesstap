import { describe, expect, it } from "bun:test";
import { groupFileChangesByResource } from "../../apps/desktop/src/lib/contents-diff";
import {
  formatHoverPath,
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
});
