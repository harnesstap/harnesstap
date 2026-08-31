import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  addResourceToPlugin,
  createPlugin,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("previewProfileApply unmanaged settings.json", () => {
  it("does not list ~/.claude/settings.json as a whole-file delete when the profile does not manage it", async () => {
    const context = await createInitializedTestContext("preview-settings-added");
    try {
      const profile = createPlugin({ name: "teads" });
      setPluginTags(profile.id, ["profile"]);

      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude", "settings.json"),
        JSON.stringify(
          {
            permissions: { allow: ["Read(*)"], deny: [] },
            model: "opus",
          },
          null,
          2,
        ),
        "utf-8",
      );

      const preview = await previewProfileApply({
        profile: "teads",
        scope: "home",
        harness: "claude-code",
      });

      expect(
        preview.files.changes.some(
          (change) =>
            change.path.replace(/\\/g, "/").endsWith(".claude/settings.json"),
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("previews settings.json as modified (not deleted) when the profile merges keys", async () => {
    const context = await createInitializedTestContext("preview-settings-managed");
    try {
      const profile = createPlugin({ name: "managed" });
      setPluginTags(profile.id, ["profile"]);
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

      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude", "settings.json"),
        JSON.stringify(
          {
            env: { KEEP: "yes" },
            model: "opus",
            permissions: { allow: ["Read(*)"], deny: [] },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const preview = await previewProfileApply({
        profile: "managed",
        scope: "home",
        harness: "claude-code",
      });

      const settingsChange = preview.files.changes.find((change) =>
        change.path.replace(/\\/g, "/").endsWith(".claude/settings.json"),
      );
      expect(settingsChange?.type).toBe("modified");
      expect(settingsChange?.type).not.toBe("added");

      await applyProfilePlugin("managed", {
        harness: "claude-code",
        conflictPolicy: "replace",
      });
      const written = JSON.parse(
        readFileSync(join(context.homeDir, ".claude", "settings.json"), "utf-8"),
      ) as {
        model: string;
        env: { KEEP: string };
        permissions: { allow: string[] };
        hooks?: unknown;
      };
      expect(written.model).toBe("opus");
      expect(written.env.KEEP).toBe("yes");
      expect(written.permissions.allow).toEqual(["Read(*)"]);
      expect(written.hooks).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
