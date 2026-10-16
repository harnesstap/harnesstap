import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { addResourceToPlugin, createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { attachProfilePlugin } from "../../src/services/profile-edit.ts";
import { riskyRemovalPaths } from "../../src/services/safe-file-removal.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const SHARED = [".claude.json", ".claude/settings.json"];

function editJson(path: string, edit: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  edit(value);
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

describe("adding a library plugin to an applied profile", () => {
  it("previews no removal or kept entry for shared configs the harness edited since apply", async () => {
    const context = await createInitializedTestContext("add-plugin-preview-shared");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "docs",
          description: "",
          content: "",
          metadata: { command: "docs-mcp" },
          source: "manual",
        }).id,
      );
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "hook",
          name: "session-start",
          description: "",
          content: "",
          metadata: { event: "SessionStart", script: "echo ok" },
          source: "manual",
        }).id,
      );
      await applyProfilePlugin("work", { harness: "claude-code", conflictPolicy: "replace" });

      // Claude Code rewrites its own keys in both files after every session.
      const claudeJson = join(context.homeDir, ".claude.json");
      const settingsJson = join(context.homeDir, ".claude", "settings.json");
      editJson(claudeJson, (value) => {
        value.numStartups = 7;
        value.oauthAccount = { accountUuid: "session" };
      });
      editJson(settingsJson, (value) => {
        value.model = "opus";
      });

      // Already in the Library: a plugin with a skill, as Discover adds it.
      const plugin = createPlugin({ name: "confluence-pages" });
      addResourceToPlugin(
        plugin.id,
        createResource({
          type: "skill",
          name: "pages",
          description: "Confluence pages",
          content: "---\nname: pages\ndescription: Confluence pages\n---\nbody\n",
          metadata: {},
          source: "manual",
        }).id,
      );
      await attachProfilePlugin("work", plugin.id);

      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(riskyRemovalPaths(preview.removals)).toEqual([]);
      const allRemovals = [
        ...preview.removals.owned_unmodified,
        ...preview.removals.owned_modified,
        ...preview.removals.unmanaged,
      ];
      for (const path of SHARED) {
        expect(allRemovals).not.toContain(path);
        const change = preview.files.changes.find((entry) => entry.path === path);
        expect(change?.removal_group).toBeUndefined();
      }

      const applied = await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      expect(applied.skipped_removals ?? []).toEqual([]);
      // Merged key by key: the harness's own keys survive, ours stay.
      const json = JSON.parse(readFileSync(claudeJson, "utf-8")) as {
        numStartups: number;
        oauthAccount: unknown;
        mcpServers: Record<string, unknown>;
      };
      expect(json.numStartups).toBe(7);
      expect(json.oauthAccount).toEqual({ accountUuid: "session" });
      expect(Object.keys(json.mcpServers)).toContain("docs");
      const settings = JSON.parse(readFileSync(settingsJson, "utf-8")) as {
        model: string;
        hooks?: unknown;
      };
      expect(settings.model).toBe("opus");
      expect(settings.hooks).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("still reports a user-modified whole-file resource as kept", async () => {
    const context = await createInitializedTestContext("add-plugin-preview-kept");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "notes",
        description: "Notes",
        content: "---\nname: notes\ndescription: Notes\n---\nbody\n",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);
      await applyProfilePlugin("work", { harness: "claude-code", conflictPolicy: "replace" });
      const skillPath = join(context.homeDir, ".claude", "skills", "notes", "SKILL.md");
      writeFileSync(skillPath, "---\nname: notes\ndescription: Notes\n---\nmine\n", "utf-8");

      const { removeResourceFromPlugin } = await import("../../src/models/plugin-model.ts");
      removeResourceFromPlugin(profile.id, skill.id);
      const preview = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(preview.removals.owned_modified).toContain(".claude/skills/notes/SKILL.md");
    } finally {
      await context.cleanup();
    }
  });
});
