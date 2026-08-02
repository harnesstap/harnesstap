import { describe, expect, it } from "bun:test";
import {
  fileChangeAbsolutePath,
  fileChangeRowActions,
} from "../../apps/desktop/src/lib/file-change-actions.ts";
import type { DriftFileChange } from "../../apps/desktop/src/lib/types.ts";

describe("fileChangeRowActions", () => {
  const root = "/Users/me";

  it("hides Add on missing (+), allows Drop when resource attached", () => {
    const change: DriftFileChange = {
      path: ".claude/skills/x/SKILL.md",
      type: "deleted",
      resource: { type: "skill", name: "x" },
    };
    const row = fileChangeRowActions(change, {
      rootPath: root,
      profileHasResource: true,
    });
    expect(row.canOpen).toBe(true);
    expect(row.canAdd).toBe(false);
    expect(row.canDrop).toBe(true);
    expect(row.absolutePath).toBe(`${root}/.claude/skills/x/SKILL.md`);
  });

  it("shows Add on modified when mapped; Drop always for restore", () => {
    const change: DriftFileChange = {
      path: ".claude/skills/x/SKILL.md",
      type: "modified",
      resource: { type: "skill", name: "x" },
    };
    const row = fileChangeRowActions(change, {
      rootPath: root,
      profileHasResource: true,
    });
    expect(row.canAdd).toBe(true);
    expect(row.canDrop).toBe(true);
  });

  it("shows Add on remove (−) when mapped; Drop only if attached", () => {
    const change: DriftFileChange = {
      path: ".claude/skills/x/SKILL.md",
      type: "added",
      resource: { type: "skill", name: "x" },
    };
    expect(
      fileChangeRowActions(change, { rootPath: root, profileHasResource: false }).canDrop,
    ).toBe(false);
    expect(
      fileChangeRowActions(change, { rootPath: root, profileHasResource: true }).canDrop,
    ).toBe(true);
    expect(
      fileChangeRowActions(change, { rootPath: root, profileHasResource: false }).canAdd,
    ).toBe(true);
  });

  it("hides Add when unmapped; ~ Drop still allowed", () => {
    const change: DriftFileChange = {
      path: ".cursor/mcp.json",
      type: "modified",
    };
    const row = fileChangeRowActions(change, {
      rootPath: root,
      profileHasResource: false,
    });
    expect(row.canAdd).toBe(false);
    expect(row.canDrop).toBe(true);
  });
});

describe("fileChangeAbsolutePath", () => {
  it("joins root and relative path", () => {
    expect(fileChangeAbsolutePath("/home/me", ".cursor/mcp.json")).toBe(
      "/home/me/.cursor/mcp.json",
    );
  });
});
