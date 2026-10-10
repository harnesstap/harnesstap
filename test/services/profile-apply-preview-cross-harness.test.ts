import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  omitTransparentCrossHarnessAdds,
  previewProfileApply,
  withManagedRemovals,
} from "../../src/services/profile-apply-preview.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { DriftFileChange } from "../../src/services/project-drift.ts";

describe("omitTransparentCrossHarnessAdds", () => {
  it("hides missing alternate-harness paths when the same skill exists elsewhere", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-cross-harness-omit-"));
    try {
      mkdirSync(join(root, ".claude/skills/pair-agent"), { recursive: true });
      writeFileSync(
        join(root, ".claude/skills/pair-agent/SKILL.md"),
        "# pair-agent\n",
        "utf-8",
      );

      const expected = [
        { path: ".claude/skills/pair-agent/SKILL.md", content: "# pair-agent\n" },
        { path: ".cursor/skills/pair-agent/SKILL.md", content: "# pair-agent\n" },
        { path: ".copilot/skills/pair-agent/SKILL.md", content: "# pair-agent\n" },
        {
          path: ".config/opencode/skills/pair-agent/SKILL.md",
          content: "# pair-agent\n",
        },
      ];
      const changes: DriftFileChange[] = [
        { path: ".cursor/skills/pair-agent/SKILL.md", type: "deleted" },
        { path: ".copilot/skills/pair-agent/SKILL.md", type: "deleted" },
        {
          path: ".config/opencode/skills/pair-agent/SKILL.md",
          type: "deleted",
        },
      ];

      expect(omitTransparentCrossHarnessAdds(root, expected, changes)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps missing paths when the resource is not on disk anywhere", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-cross-harness-missing-"));
    try {
      const expected = [
        { path: ".claude/skills/new-skill/SKILL.md", content: "# new\n" },
        { path: ".copilot/skills/new-skill/SKILL.md", content: "# new\n" },
      ];
      const changes: DriftFileChange[] = [
        { path: ".claude/skills/new-skill/SKILL.md", type: "deleted" },
        { path: ".copilot/skills/new-skill/SKILL.md", type: "deleted" },
      ];
      expect(omitTransparentCrossHarnessAdds(root, expected, changes)).toEqual(
        changes,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps modified and removal changes", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-cross-harness-keep-"));
    try {
      mkdirSync(join(root, ".claude/skills/x"), { recursive: true });
      writeFileSync(join(root, ".claude/skills/x/SKILL.md"), "# x\n", "utf-8");
      const expected = [
        { path: ".claude/skills/x/SKILL.md", content: "# x\n" },
        { path: ".copilot/skills/x/SKILL.md", content: "# x\n" },
      ];
      const changes: DriftFileChange[] = [
        { path: ".claude/skills/x/SKILL.md", type: "modified" },
        { path: ".copilot/skills/x/SKILL.md", type: "deleted" },
        { path: ".claude/skills/old/SKILL.md", type: "added" },
      ];
      expect(omitTransparentCrossHarnessAdds(root, expected, changes)).toEqual([
        { path: ".claude/skills/x/SKILL.md", type: "modified" },
        { path: ".claude/skills/old/SKILL.md", type: "added" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hides leftover extra-harness copies when the resource is still expected", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-cross-harness-extra-"));
    try {
      const expected = [
        { path: ".claude/skills/ubiquitous-language/SKILL.md", content: "# glossary\n" },
        { path: ".agents/skills/ubiquitous-language/SKILL.md", content: "# glossary\n" },
      ];
      const changes: DriftFileChange[] = [
        {
          path: ".cursor/skills/ubiquitous-language/SKILL.md",
          type: "added",
        },
      ];
      expect(omitTransparentCrossHarnessAdds(root, expected, changes)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hides extra-harness content diffs when another copy already matches", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-cross-harness-extra-mod-"));
    try {
      mkdirSync(join(root, ".claude/skills/skillify"), { recursive: true });
      mkdirSync(join(root, ".cursor/skills/skillify"), { recursive: true });
      writeFileSync(
        join(root, ".claude/skills/skillify/SKILL.md"),
        "---\nname: skillify\n---\n\n# skillify\n",
        "utf-8",
      );
      writeFileSync(
        join(root, ".cursor/skills/skillify/SKILL.md"),
        "---\nname: skillify\n---\n---\nname: skillify\n---\n\n# skillify\n",
        "utf-8",
      );
      const expected = [
        {
          path: ".claude/skills/skillify/SKILL.md",
          content: "---\nname: skillify\n---\n\n# skillify\n",
        },
        {
          path: ".cursor/skills/skillify/SKILL.md",
          content: "---\nname: skillify\n---\n\n# skillify\n",
        },
      ];
      const changes: DriftFileChange[] = [
        { path: ".cursor/skills/skillify/SKILL.md", type: "modified" },
      ];
      expect(omitTransparentCrossHarnessAdds(root, expected, changes)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("withManagedRemovals", () => {
  it("only lists planned removals that still exist on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-managed-removals-"));
    try {
      mkdirSync(join(root, ".claude/skills/live"), { recursive: true });
      writeFileSync(join(root, ".claude/skills/live/SKILL.md"), "# live\n", "utf-8");

      const changes = withManagedRemovals(
        root,
        [],
        [
          ".claude/skills/live/SKILL.md",
          ".claude/skills/pair-agent/SKILL.md",
          ".agents/skills/pair-agent/SKILL.md",
        ],
      );

      expect(changes).toEqual([
        {
          path: ".claude/skills/live/SKILL.md",
          type: "added",
          removal_group: "unmanaged",
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the shared ownership classifier so preview matches the confirm groups", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-preview-classifier-"));
    try {
      mkdirSync(join(root, ".claude/skills/user"), { recursive: true });
      mkdirSync(join(root, ".claude/rules"), { recursive: true });
      writeFileSync(join(root, ".claude/skills/user/SKILL.md"), "# user\n", "utf-8");
      writeFileSync(join(root, ".claude/rules/security.md"), "# sec\n", "utf-8");

      const changes = withManagedRemovals(
        root,
        [
          { path: ".claude/skills/user/SKILL.md", type: "added" },
          { path: ".claude/rules/security.md", type: "added" },
        ],
        [
          ".claude/skills/user/SKILL.md",
          ".claude/rules/security.md",
        ],
      );

      expect(changes.map((change) => change.removal_group)).toEqual([
        "unmanaged",
        "unmanaged",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("previewProfileApply cross-harness adds", () => {
  it("does not list missing copilot skill copies when claude already has the skill", async () => {
    const context = await createInitializedTestContext("preview-cross-harness");
    try {
      mkdirSync(join(context.homeDir, ".copilot"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".copilot/mcp-config.json"),
        "{}\n",
        "utf-8",
      );

      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "pair-agent",
        description: "",
        content: "# pair-agent",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code,copilot-cli",
      });

      expect(
        preview.files.changes.some(
          (change) => change.path === ".copilot/skills/pair-agent/SKILL.md",
        ),
      ).toBe(false);
      expect(
        preview.files.changes.some(
          (change) =>
            change.path === ".claude/skills/pair-agent/SKILL.md"
            && change.type === "deleted",
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("does not list an identical-content skill relocate when live is already at ~/.claude/skills", async () => {
    const context = await createInitializedTestContext("preview-skill-live-path");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "dolibarr-api",
        description: "",
        content: "# dolibarr-api",
        metadata: {},
        source: "~/.claude/skills/dolibarr-api/SKILL.md",
      });
      addResourceToPlugin(profile.id, skill.id);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code,cursor",
      });

      expect(
        preview.files.changes.filter((change) =>
          change.path.includes("dolibarr-api"),
        ),
      ).toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
