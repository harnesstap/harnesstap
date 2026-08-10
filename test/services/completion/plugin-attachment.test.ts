import { describe, expect, it } from "bun:test";
import {
  addResourceToPlugin,
  createPlugin,
} from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import {
  completePluginEditAddAttachment,
  completePluginEditRemoveAttachment,
} from "../../../src/services/completion/providers/plugin-attachment.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { makeResourceInput } from "../../helpers/resources.ts";

describe("plugin edit attachment completion", () => {
  it("suggests typed resources and other plugins for --add", async () => {
    const context = await createInitializedTestContext("completion-plugin-edit-add");
    try {
      const targetPlugin = createPlugin({ name: "target-plugin", version: "1.0.0" });
      createPlugin({ name: "dep-plugin", version: "1.0.0" });
      const _skill = createResource(makeResourceInput({ name: "combine-skill" }));

      const candidates = completePluginEditAddAttachment({
        commandPath: ["plugin", "edit"],
        slot: "flag-value",
        flag: "add",
        consumedPositionals: [targetPlugin.name],
        prefix: "",
        localDataAvailable: true,
      });

      const values = candidates.map((entry) => entry.value);
      expect(values).toContain("skill:combine-skill");
      expect(values).toContain("plugin:dep-plugin");
    } finally {
      await context.cleanup();
    }
  });

  it("suggests current attachments for --remove", async () => {
    const context = await createInitializedTestContext("completion-plugin-edit-remove");
    try {
      const plugin = createPlugin({ name: "source-plugin", version: "1.0.0" });
      const skill = createResource(makeResourceInput({ name: "attached-skill" }));
      addResourceToPlugin(plugin.id, skill.id);

      const candidates = completePluginEditRemoveAttachment({
        commandPath: ["plugin", "edit"],
        slot: "flag-value",
        flag: "remove",
        consumedPositionals: [plugin.name],
        prefix: "",
        localDataAvailable: true,
      });

      expect(candidates.map((entry) => entry.value)).toContain("skill:attached-skill");
    } finally {
      await context.cleanup();
    }
  });
});
