import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flattenUniqueFiles,
  pinSkillEmitsToExistingLivePaths,
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

  it("does not rewrite host plugin install-tree skills onto shared skill dirs", () => {
    const preferred = preferSharedSkillEmits(
      [
        {
          platformId: "cursor",
          files: [
            {
              path: ".cursor/plugins/cache/demo/demo/1.0.0/skills/hello/SKILL.md",
              content: "plugin",
            },
            { path: ".agents/skills/hello/SKILL.md", content: "native" },
          ],
        },
        {
          platformId: "claude-code",
          files: [
            {
              path: ".claude/plugins/cache/demo/demo/1.0.0/skills/hello/SKILL.md",
              content: "plugin",
            },
          ],
        },
      ],
      ["cursor", "claude-code"],
      "global",
    );
    const files = flattenUniqueFiles(preferred);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toContain(
      ".cursor/plugins/cache/demo/demo/1.0.0/skills/hello/SKILL.md",
    );
    expect(paths).toContain(
      ".claude/plugins/cache/demo/demo/1.0.0/skills/hello/SKILL.md",
    );
  });
});

describe("pinSkillEmitsToExistingLivePaths", () => {
  it("keeps an identical skill at the live user path instead of relocating it", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-pin-skill-live-"));
    try {
      mkdirSync(join(root, ".claude/skills/dolibarr-api"), { recursive: true });
      writeFileSync(
        join(root, ".claude/skills/dolibarr-api/SKILL.md"),
        "# dolibarr-api\n",
        "utf-8",
      );

      const pinned = pinSkillEmitsToExistingLivePaths(
        root,
        preferSharedSkillEmits(
          [
            {
              platformId: "claude-code",
              files: [
                { path: ".claude/skills/dolibarr-api/SKILL.md", content: "# dolibarr-api\n" },
              ],
            },
            {
              platformId: "cursor",
              files: [
                { path: ".cursor/skills/dolibarr-api/SKILL.md", content: "# dolibarr-api\n" },
              ],
            },
          ],
          ["claude-code", "cursor"],
          "global",
        ),
        ["claude-code", "cursor"],
        "global",
      );

      const paths = flattenUniqueFiles(pinned).map((file) => file.path);
      expect(paths).toEqual([".claude/skills/dolibarr-api/SKILL.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps surface_warnings when remapping emit paths", () => {
    const warning = {
      harness: "claude-code",
      path: "hooks/register.js",
      category: "claude-mod",
      message: "mods skipped",
      alias_harnesses: ["cursor"],
    };
    const pinned = pinSkillEmitsToExistingLivePaths(
      "/tmp/ht-no-live-skills",
      preferSharedSkillEmits(
        [
          {
            platformId: "cursor",
            files: [{ path: ".cursor/rules/demo.mdc", content: "rule" }],
            surface_warnings: [warning],
          },
        ],
        ["cursor"],
        "project",
      ),
      ["cursor"],
      "project",
    );
    expect(pinned[0]?.surface_warnings).toEqual([warning]);
  });
});
