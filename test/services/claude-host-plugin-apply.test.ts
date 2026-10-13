import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { setHarnessPreference } from "../../src/models/harness.ts";
import { createPlugin, setPluginTags } from "../../src/models/plugin-model.ts";
import { addDependency } from "../../src/services/plugin-dependency.ts";
import { importPluginFromGitHubRef } from "../../src/services/plugin-git-import.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

const ponytailLayoutFixture = join(
  import.meta.dirname,
  "../fixtures/plugin-import/git-origin-ponytail",
);

describe("claude host plugin apply", () => {
  it("registers a git plugin instead of writing its skills standalone", async () => {
    const context = await createInitializedTestContext("claude-host-plugin-apply");
    try {
      await importPluginFromGitHubRef("DietrichGebert/ponytail", {
        refreshGit: async (opts) => {
          mkdirSync(opts.targetDir, { recursive: true });
          cpSync(ponytailLayoutFixture, opts.targetDir, { recursive: true });
          return { ok: true, sha: "abc123def456", message: "ok" };
        },
      });

      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      addDependency(profile.id, "ponytail");
      setHarnessPreference({ registered_harnesses: ["claude-code", "opencode"] });

      const applied = await applyProfilePlugin("work", {
        harness: "claude-code,opencode",
        conflictPolicy: "replace",
      });
      expect(applied.cancelled).toBe(false);

      const installedPath = join(context.homeDir, ".claude/plugins/installed_plugins.json");
      expect(existsSync(installedPath)).toBe(true);
      const installed = JSON.parse(readFileSync(installedPath, "utf-8")) as {
        plugins: Record<string, unknown>;
      };
      expect(installed.plugins["ponytail@local"]).toBeDefined();

      const settings = JSON.parse(
        readFileSync(join(context.homeDir, ".claude/settings.json"), "utf-8"),
      ) as { enabledPlugins?: Record<string, boolean> };
      expect(settings.enabledPlugins?.["ponytail@local"]).toBe(true);

      expect(existsSync(join(context.homeDir, ".claude/skills/ponytail/SKILL.md"))).toBe(false);
      expect(
        existsSync(join(context.homeDir, ".claude/plugins/cache/local/ponytail")),
      ).toBe(true);
      expect(
        existsSync(join(context.homeDir, ".config/opencode/skills/ponytail/SKILL.md"))
        || existsSync(join(context.homeDir, ".agents/skills/ponytail/SKILL.md")),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
