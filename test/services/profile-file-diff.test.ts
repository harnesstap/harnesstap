import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPlugin, addResourceToPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { getManagedFileDiff } from "../../src/services/profile-file-diff.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("getManagedFileDiff", () => {
  it("returns expected snapshot content and drifted live content", async () => {
    const context = await createInitializedTestContext("managed-file-diff");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      const skill = createResource({
        type: "skill",
        name: "manual-skill",
        description: "",
        content: "# original",
        metadata: {},
        source: "manual",
      });
      addResourceToPlugin(profile.id, skill.id);
      await applyProfilePlugin("work", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });

      const relative = ".claude/skills/manual-skill/SKILL.md";
      const absolute = join(context.homeDir, relative);
      const drifted =
        "---\nname: manual-skill\ndescription: x\n---\n\n# drifted\n";
      writeFileSync(absolute, drifted, "utf-8");

      const result = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });

      expect(result.path).toBe(relative);
      expect(result.absolute_path).toBe(absolute);
      expect(result.expected).toContain("# original");
      expect(result.current).toBe(drifted);
    } finally {
      await context.cleanup();
    }
  });

  it("does not wipe extra live skill body when the profile snapshot is a subset", async () => {
    const context = await createInitializedTestContext("managed-file-diff-subset");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "skill",
          name: "dolibarr-development",
          description: "short",
          content: "",
          metadata: {},
          source: "manual",
        }).id,
      );

      const relative = ".claude/skills/dolibarr-development/SKILL.md";
      const absolute = join(context.homeDir, relative);
      mkdirSync(join(context.homeDir, ".claude", "skills", "dolibarr-development"), {
        recursive: true,
      });
      const live = [
        "---",
        "name: dolibarr-development",
        "description: short",
        "allowed-tools: Read",
        "---",
        "",
        "# Dolibarr Developer Skill",
        "## When to Use",
        "Lots of live guidance.",
      ].join("\n");
      writeFileSync(absolute, live, "utf-8");

      const result = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "claude-code",
      });

      expect(result.expected).toContain("# Dolibarr Developer Skill");
      expect(result.expected).toContain("Lots of live guidance.");
      expect(result.expected).toContain("allowed-tools:");
    } finally {
      await context.cleanup();
    }
  });

  it("scopes mcp.json diffs to the selected server", async () => {
    const context = await createInitializedTestContext("managed-file-diff-mcp-scope");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "alpha",
          description: "",
          content: "",
          metadata: { transport: "http", url: "https://example.com/alpha-expected" },
          source: "~/.cursor/mcp.json",
        }).id,
      );
      addResourceToPlugin(
        profile.id,
        createResource({
          type: "mcp_server",
          name: "beta",
          description: "",
          content: "",
          metadata: { transport: "http", url: "https://example.com/beta-expected" },
          source: "~/.cursor/mcp.json",
        }).id,
      );
      await applyProfilePlugin("work", {
        harness: "cursor",
        conflictPolicy: "replace",
      });

      const relative = ".cursor/mcp.json";
      mkdirSync(join(context.homeDir, ".cursor"), { recursive: true });
      writeFileSync(
        join(context.homeDir, relative),
        `${JSON.stringify(
          {
            mcpServers: {
              alpha: { url: "https://example.com/alpha-live" },
              beta: { url: "https://example.com/beta-live" },
            },
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      const full = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "cursor",
      });
      expect(full.current).toContain("alpha-live");
      expect(full.current).toContain("beta-live");
      expect(full.expected).toContain("alpha-expected");
      expect(full.expected).toContain("beta-expected");

      const scoped = await getManagedFileDiff({
        profileSelector: "work",
        path: relative,
        scope: "home",
        harness: "cursor",
        resource: { type: "mcp_server", name: "alpha" },
      });
      expect(scoped.current).toContain("alpha-live");
      expect(scoped.current).not.toContain("beta-live");
      expect(scoped.expected).toContain("alpha-expected");
      expect(scoped.expected).not.toContain("beta-expected");
    } finally {
      await context.cleanup();
    }
  });
});
