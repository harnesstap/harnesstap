import { describe, expect, it } from "bun:test";
import {
  alsoUseOnLabel,
  formatHarnessList,
  portableScopeTip,
  SCOPE_COPY,
  subsetScopeLine,
} from "../../src/copy/scope.ts";

describe("DS-1 scope copy", () => {
  it("joins two and three names with and, not a trailing comma", () => {
    expect(formatHarnessList(["Claude Code", "Codex"])).toBe("Claude Code and Codex");
    expect(formatHarnessList(["Claude Code", "Codex", "Cursor"])).toBe(
      "Claude Code, Codex and Cursor",
    );
  });

  it("uses the origin-safe Main tooltip", () => {
    expect(SCOPE_COPY.mainTooltip).toBe(
      "Your main harness. It wins when harnesses disagree.",
    );
  });

  it("caps subset lines at three names then n more", () => {
    expect(subsetScopeLine(["claude-code", "codex"])).toBe("Only on Claude Code and Codex");
    expect(subsetScopeLine(["claude-code", "codex", "cursor"])).toBe(
      "Only on Claude Code, Codex and Cursor",
    );
    expect(subsetScopeLine(["claude-code", "codex", "cursor", "opencode"])).toBe(
      "Only on Claude Code, Codex, Cursor and 1 more",
    );
  });

  it("builds the portable MCP action label", () => {
    expect(alsoUseOnLabel(["cursor", "codex"])).toBe("Also use on Cursor and Codex");
  });

  it("builds a CLI tip that embeds the given command", () => {
    expect(
      portableScopeTip({
        resourceName: "filesystem",
        targetIds: ["cursor", "codex"],
        command: "ht resource scope filesystem --add cursor,codex",
      }),
    ).toBe(
      'Tip: "filesystem" also works on Cursor and Codex. Run ht resource scope filesystem --add cursor,codex.',
    );
  });
});
