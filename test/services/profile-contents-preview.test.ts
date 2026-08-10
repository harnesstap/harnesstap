import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { setActiveProfileName } from "../../src/services/active-profile.ts";
import { attachPluginPinToPlugin } from "../../src/services/plugin-composition.ts";
import { buildProfileContents } from "../../src/services/profile-contents.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { detectGlobalProfileStatus } from "../../src/services/global-profile-drift.ts";

describe("profile contents and apply preview", () => {
  it("summarizes plugins, resources, pins, and mcp for a profile", async () => {
    const context = await createInitializedTestContext("profile-contents-summary");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const instruction = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# guide",
        metadata: {},
        source: "manual",
      });
      const mcp = createResource({
        type: "mcp_server",
        name: "docs",
        description: "",
        content: JSON.stringify({ command: "docs-mcp" }),
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, instruction.id);
      addResourceToPlugin(plugin.id, mcp.id);
      attachPluginPinToPlugin(plugin.id, "demo@demo-market", "1.0.0");

      const contents = buildProfileContents("work");
      expect(contents).not.toBeNull();
      expect(contents?.plugins.map((entry) => entry.name)).toContain("work");
      expect(contents?.stack_resource_count).toBe(2);
      expect(contents?.stack_summary).toContain("instruction");
      expect(contents?.stack_summary).toContain("mcp_server");
      expect(contents?.type_counts.instruction).toBe(1);
      expect(contents?.type_counts.mcp_server).toBe(1);
      expect(contents?.type_counts.plugin).toBeGreaterThanOrEqual(1);
            expect(contents?.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: instruction.id,
            type: "instruction",
            name: "profile-guide",
            source: "manual",
          }),
          expect.objectContaining({
            id: mcp.id,
            type: "mcp_server",
            name: "docs",
            source: "manual",
          }),
        ]),
      );
      const workPlugin = contents?.plugins.find((entry) => entry.name === "work");
      expect(workPlugin?.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: instruction.id,
            type: "instruction",
            name: "profile-guide",
            source: "manual",
          }),
          expect.objectContaining({
            id: mcp.id,
            type: "mcp_server",
            name: "docs",
            source: "manual",
          }),
        ]),
      );
      expect(contents?.plugin_pins).toEqual([
        { ref: "demo@demo-market", version_constraint: "1.0.0" },
      ]);
      expect(contents?.mcp_servers).toEqual(["docs"]);
    } finally {
      await context.cleanup();
    }
  });

  it("includes contents on global status", async () => {
    const context = await createInitializedTestContext("profile-contents-status");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "skill",
        name: "ship",
        description: "",
        content: "# ship",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);
      setActiveProfileName("work");

      const status = await detectGlobalProfileStatus({ depth: "full" });
      expect(status.contents?.stack_summary).toContain("skill");
      expect(status.contents?.plugins[0]?.name).toBe("work");
    } finally {
      await context.cleanup();
    }
  });

  it("previews home apply against live files and harnesses", async () => {
    const context = await createInitializedTestContext("profile-apply-preview-home");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      const resource = createResource({
        type: "instruction",
        name: "profile-guide",
        description: "",
        content: "# guide",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(plugin.id, resource.id);
      setActiveProfileName("work");

      const beforeApply = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(beforeApply.relative_to_active).toBe(true);
      expect(beforeApply.contents?.stack_resource_count).toBe(1);
      expect(beforeApply.files.expected_count).toBeGreaterThan(0);
      expect(beforeApply.files.changes.some((change) => change.type === "deleted")).toBe(true);

      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const afterApply = await previewProfileApply({
        profile: "work",
        scope: "home",
        harness: "claude-code",
      });
      expect(afterApply.files.changes).toEqual([]);
      expect(afterApply.harnesses?.["claude-code"]).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });

  it("requires projectPath for project-scope preview", async () => {
    const context = await createInitializedTestContext("profile-apply-preview-project");
    try {
      const plugin = createPlugin({ name: "work" });
      setPluginTags(plugin.id, ["profile"]);
      setActiveProfileName("work");

      const preview = await previewProfileApply({
        profile: "work",
        scope: "project",
      });
      expect(preview.warning).toMatch(/projectPath/i);
      expect(preview.files.expected_count).toBe(0);
    } finally {
      await context.cleanup();
    }
  });
});
