import { describe, expect, it } from "bun:test";
import { isTransparentCrossHarnessGap } from "../../src/services/cross-harness-gap.ts";

const CLAUDE = ".claude/skills/tiny-skill/SKILL.md";
const AGENTS = ".agents/skills/tiny-skill/SKILL.md";

describe("isTransparentCrossHarnessGap", () => {
  it("treats a sibling the new harness cannot read as a real gap", () => {
    expect(isTransparentCrossHarnessGap({
      path: AGENTS,
      onDiskSiblingPaths: [CLAUDE],
      scope: { kind: "subset", harnesses: ["claude-code", "codex"] },
    })).toBe(false);
  });

  it("keeps an alternate copy transparent when scope is all or unset", () => {
    expect(isTransparentCrossHarnessGap({
      path: AGENTS,
      onDiskSiblingPaths: [CLAUDE],
      scope: { kind: "all" },
    })).toBe(true);
    expect(isTransparentCrossHarnessGap({
      path: AGENTS,
      onDiskSiblingPaths: [CLAUDE],
    })).toBe(true);
  });

  it("is not transparent when nothing is on disk", () => {
    expect(isTransparentCrossHarnessGap({
      path: AGENTS,
      onDiskSiblingPaths: [],
      scope: { kind: "subset", harnesses: ["codex"] },
    })).toBe(false);
  });
});
