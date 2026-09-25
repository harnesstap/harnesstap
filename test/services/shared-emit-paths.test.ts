import { describe, expect, it } from "bun:test";
import {
  flattenUniqueFiles,
  preferSharedSkillEmits,
  skillConsumeDirs,
} from "../../src/services/shared-emit-paths.ts";

describe("preferSharedSkillEmits", () => {
  it("lists .agents/skills as a Cursor consume dir from the project hub", () => {
    expect(skillConsumeDirs("cursor", "global")).toContain(".agents/skills/");
    expect(skillConsumeDirs("cursor", "project")).toContain(".agents/skills/");
  });

  it("rewrites native skill trees onto .agents/skills when two harnesses can read it", () => {
    const preferred = preferSharedSkillEmits(
      [
        {
          platformId: "cursor",
          files: [
            { path: ".agents/skills/foo/SKILL.md", content: "cursor" },
          ],
        },
        {
          platformId: "grok-build",
          files: [
            { path: ".grok/skills/foo/SKILL.md", content: "cursor" },
            { path: ".grok/skills/foo/scripts/run.sh", content: "echo" },
          ],
        },
      ],
      ["cursor", "grok-build"],
      "project",
    );

    const files = flattenUniqueFiles(preferred);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual([
      ".agents/skills/foo/SKILL.md",
      ".agents/skills/foo/scripts/run.sh",
    ]);
    expect(paths.some((path) => path.startsWith(".grok/skills/"))).toBe(false);
  });

  it("keeps native emit when a harness cannot read the shared tree", () => {
    const preferred = preferSharedSkillEmits(
      [
        {
          platformId: "claude-code",
          files: [{ path: ".claude/skills/foo/SKILL.md", content: "body" }],
        },
        {
          platformId: "cursor",
          files: [{ path: ".agents/skills/foo/SKILL.md", content: "body" }],
        },
      ],
      ["claude-code", "cursor"],
      "project",
    );
    const files = flattenUniqueFiles(preferred);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toContain(".claude/skills/foo/SKILL.md");
    expect(paths.filter((path) => path.endsWith("foo/SKILL.md"))).toHaveLength(1);
  });
});
