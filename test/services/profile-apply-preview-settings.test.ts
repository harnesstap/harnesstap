import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  addResourceToLayer,
  createLayer,
  setLayerTags,
} from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { previewProfileApply } from "../../src/services/profile-apply-preview.ts";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("previewProfileApply unmanaged settings.json", () => {
  it("lists ~/.claude/settings.json as added when the profile does not manage it", async () => {
    const context = await createInitializedTestContext("preview-settings-added");
    try {
      const profile = createLayer({ name: "teads" });
      setLayerTags(profile.id, ["profile"]);

      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude", "settings.json"),
        JSON.stringify(
          {
            permissions: { allow: ["Read(*)"], deny: [] },
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
            change.path.replace(/\\/g, "/").endsWith(".claude/settings.json")
            && change.type === "added",
        ),
      ).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("does not list settings.json as added when the profile manages it", async () => {
    const context = await createInitializedTestContext("preview-settings-managed");
    try {
      const profile = createLayer({ name: "managed" });
      setLayerTags(profile.id, ["profile"]);
      addResourceToLayer(
        profile.id,
        createResource({
          type: "env_var",
          name: "DEMO_KEY",
          description: "",
          content: "",
          metadata: { key: "DEMO_KEY", value: "x" },
          source: "manual",
        }).id,
      );

      mkdirSync(join(context.homeDir, ".claude"), { recursive: true });
      writeFileSync(
        join(context.homeDir, ".claude", "settings.json"),
        JSON.stringify({ env: { DEMO_KEY: "x" }, permissions: { allow: ["Read(*)"], deny: [] } }, null, 2),
        "utf-8",
      );

      const preview = await previewProfileApply({
        profile: "managed",
        scope: "home",
        harness: "claude-code",
      });

      expect(
        preview.files.changes.some(
          (change) =>
            change.path.replace(/\\/g, "/").endsWith(".claude/settings.json")
            && change.type === "added",
        ),
      ).toBe(false);
    } finally {
      await context.cleanup();
    }
  });
});
