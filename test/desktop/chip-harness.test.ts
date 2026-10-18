import { describe, expect, it } from "bun:test";
import {
  chipHarnessHint,
  chipHarnessLabel,
  LAST_TOOL_HINT,
  sectionAlsoUseOn,
  uncheckHarnessGroup,
} from "../../apps/desktop/src/lib/chip-harness.ts";
import { harnessMarkId } from "../../apps/desktop/src/components/HarnessIcons.tsx";

const REGISTERED = ["claude-code", "cursor", "codex", "opencode"];
const NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  opencode: "OpenCode",
};
const names = (id: string) => NAMES[id] ?? id;

describe("chip harness tooltip text", () => {
  it("says nothing for a resource on every harness", () => {
    expect(chipHarnessLabel(undefined, REGISTERED, names)).toBeNull();
    expect(chipHarnessLabel("all", REGISTERED, names)).toBeNull();
    expect(chipHarnessLabel([...REGISTERED], REGISTERED, names)).toBeNull();
  });

  it("names where a subset resource is, never what is missing", () => {
    expect(chipHarnessLabel(["claude-code"], REGISTERED, names)?.full).toBe("Only in Claude Code");
    expect(chipHarnessLabel(["codex", "cursor"], REGISTERED, names)?.full).toBe("Only in Cursor and Codex");
    expect(chipHarnessLabel(["codex", "cursor", "claude-code"], REGISTERED, names)?.full).toBe(
      "Only in Claude Code, Cursor and Codex",
    );
  });

  it("explains a harness that is not turned on", () => {
    const label = chipHarnessLabel(["opencode"], ["claude-code", "cursor"], names);
    expect(label?.offIds).toEqual(["opencode"]);
    expect(label?.full).toBe("Only in OpenCode. OpenCode is not turned on, so nothing is written there");
    expect(label?.full).not.toMatch(/[\u2013\u2014\u2026]/);
  });

  it("leaves out tools that are not turned on when it runs in some that are", () => {
    const shared = ["cursor", "codex", "warp", "goose", "cline"];
    expect(chipHarnessLabel(shared, ["claude-code", "cursor", "codex"], names)?.full).toBe("Only in Cursor and Codex");
    const many = chipHarnessLabel(["warp", "goose", "cline", "zed"], ["claude-code", "cursor"], names);
    expect(many?.full).toBe("Only in cline, goose, warp and 1 more. They are not turned on, so nothing is written there");
  });
});

describe("chip harness hint circle", () => {
  it("is absent on every harness", () => {
    expect(chipHarnessHint(undefined, REGISTERED)).toBeNull();
    expect(chipHarnessHint("all", REGISTERED)).toBeNull();
    expect(chipHarnessHint([...REGISTERED].reverse(), REGISTERED)).toBeNull();
  });

  it("shows the one harness's mark", () => {
    expect(chipHarnessHint(["opencode"], REGISTERED)).toEqual({ kind: "icon", harnessId: "opencode" });
    expect(chipHarnessHint(["opencode"], ["claude-code", "cursor"])).toEqual({
      kind: "icon",
      harnessId: "opencode",
    });
  });

  it("counts two or more but not all", () => {
    expect(chipHarnessHint(["cursor", "codex"], REGISTERED)).toEqual({ kind: "count", count: 2 });
    expect(chipHarnessHint(["cursor", "codex", "opencode"], REGISTERED)).toEqual({ kind: "count", count: 3 });
  });

  it("counts only tools turned on when there are any", () => {
    const shared = ["cursor", "codex", "warp", "goose", "cline"];
    expect(chipHarnessHint(shared, ["claude-code", "cursor", "codex"])).toEqual({ kind: "count", count: 2 });
    expect(chipHarnessHint(["cursor", "warp"], ["claude-code", "cursor"])).toEqual({ kind: "icon", harnessId: "cursor" });
    expect(chipHarnessHint(["warp", "goose"], ["claude-code", "cursor"])).toEqual({ kind: "count", count: 2 });
  });
});

describe("Tools popover last-harness guard", () => {
  it("allows unchecking while another tool stays checked", () => {
    expect(uncheckHarnessGroup(["claude-code", "cursor"], ["cursor"])).toEqual(["claude-code"]);
  });

  it("refuses to leave a resource in no tool", () => {
    expect(uncheckHarnessGroup(["cursor"], ["cursor"])).toBeNull();
    expect(uncheckHarnessGroup(["claude-code", "cursor"], ["claude-code", "cursor"])).toBeNull();
    expect(LAST_TOOL_HINT).toBe("Keep at least one tool. Check another one first.");
  });
});

describe("section suggestion grouping", () => {
  const mcp = (name: string, stored: "all" | string[] | undefined) => ({
    key: `mcp_server:${name}`,
    name,
    type: "mcp_server",
    stored,
  });

  it("groups every MCP that could also run elsewhere into one line", () => {
    const suggestion = sectionAlsoUseOn(
      [mcp("remote-docs", ["claude-code"]), mcp("github", ["claude-code", "cursor"]), mcp("filesystem", undefined)],
      ["claude-code", "cursor", "codex"],
      names,
      () => false,
    );
    expect(suggestion?.items.map((item) => item.name)).toEqual(["remote-docs", "github"]);
    expect(suggestion?.items[1]?.targets).toEqual(["codex"]);
    expect(suggestion?.targets).toEqual(["cursor", "codex"]);
    expect(suggestion?.label).toBe("2 MCPs could also run on Cursor and Codex");
    expect(suggestion?.list).toBe("remote-docs and github");
  });

  it("uses the singular for one and skips dismissed resources", () => {
    const suggestion = sectionAlsoUseOn(
      [mcp("remote-docs", ["claude-code"]), mcp("github", ["claude-code"])],
      ["claude-code", "cursor"],
      names,
      (name) => name === "github",
    );
    expect(suggestion?.label).toBe("1 MCP could also run on Cursor");
  });

  it("is absent with nothing to suggest, for non-MCPs, or with one harness", () => {
    expect(sectionAlsoUseOn([mcp("filesystem", undefined)], REGISTERED, names, () => false)).toBeNull();
    expect(
      sectionAlsoUseOn(
        [{ key: "skill:a", name: "a", type: "skill", stored: ["cursor"] }],
        REGISTERED,
        names,
        () => false,
      ),
    ).toBeNull();
    expect(sectionAlsoUseOn([mcp("x", ["cursor"])], ["cursor"], names, () => false)).toBeNull();
  });
});

describe("harness marks", () => {
  it("fold display forms to the catalog id so OpenCode gets its logo", () => {
    expect(harnessMarkId("opencode")).toBe("opencode");
    expect(harnessMarkId("OpenCode")).toBe("opencode");
    expect(harnessMarkId("open_code")).toBe("opencode");
    expect(harnessMarkId("Claude Code")).toBe("claude-code");
    expect(harnessMarkId("unknown-tool")).toBe("unknown-tool");
  });
});
