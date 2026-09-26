import { describe, expect, it } from "bun:test";
import { pairInstructionFiles } from "../../src/services/instruction-file-links.ts";

describe("pairInstructionFiles", () => {
  it("keeps AGENTS.md and links CLAUDE.md when content matches", () => {
    const paired = pairInstructionFiles(
      [
        { path: "CLAUDE.md", content: "shared rules\n" },
        { path: "AGENTS.md", content: "shared rules\n" },
        { path: ".claude/skills/x/SKILL.md", content: "skill" },
      ],
      "symlink",
    );
    expect(paired.files.map((file) => file.path).sort()).toEqual([
      ".claude/skills/x/SKILL.md",
      "AGENTS.md",
    ]);
    expect(paired.links).toEqual([{ path: "CLAUDE.md", target: "AGENTS.md" }]);
  });

  it("does not link when copy mode is set", () => {
    const paired = pairInstructionFiles(
      [
        { path: "CLAUDE.md", content: "shared rules\n" },
        { path: "AGENTS.md", content: "shared rules\n" },
      ],
      "copy",
    );
    expect(paired.files).toHaveLength(2);
    expect(paired.links).toEqual([]);
  });

  it("leaves different instruction bodies as separate files", () => {
    const paired = pairInstructionFiles(
      [
        { path: "CLAUDE.md", content: "claude only\n" },
        { path: "AGENTS.md", content: "agents only\n" },
      ],
      "symlink",
    );
    expect(paired.files).toHaveLength(2);
    expect(paired.links).toEqual([]);
  });
});
