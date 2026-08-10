import { describe, expect, it } from "bun:test";
import {
  addResourceToLayer,
  createLayer,
} from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import {
  completeLayerEditAddAttachment,
  completeLayerEditRemoveAttachment,
} from "../../../src/services/completion/providers/layer-attachment.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { makeResourceInput } from "../../helpers/resources.ts";

describe("layer edit attachment completion", () => {
  it("suggests typed resources and other layers for --add", async () => {
    const context = await createInitializedTestContext("completion-layer-edit-add");
    try {
      const targetLayer = createLayer({ name: "target-layer", version: "1.0.0" });
      createLayer({ name: "dep-layer", version: "1.0.0" });
      const _skill = createResource(makeResourceInput({ name: "combine-skill" }));

      const candidates = completeLayerEditAddAttachment({
        commandPath: ["layer", "edit"],
        slot: "flag-value",
        flag: "add",
        consumedPositionals: [targetLayer.name],
        prefix: "",
        localDataAvailable: true,
      });

      const values = candidates.map((entry) => entry.value);
      expect(values).toContain("skill:combine-skill");
      expect(values).toContain("layer:dep-layer");
    } finally {
      await context.cleanup();
    }
  });

  it("suggests current attachments for --remove", async () => {
    const context = await createInitializedTestContext("completion-layer-edit-remove");
    try {
      const layer = createLayer({ name: "source-layer", version: "1.0.0" });
      const skill = createResource(makeResourceInput({ name: "attached-skill" }));
      addResourceToLayer(layer.id, skill.id);

      const candidates = completeLayerEditRemoveAttachment({
        commandPath: ["layer", "edit"],
        slot: "flag-value",
        flag: "remove",
        consumedPositionals: [layer.name],
        prefix: "",
        localDataAvailable: true,
      });

      expect(candidates.map((entry) => entry.value)).toContain("skill:attached-skill");
    } finally {
      await context.cleanup();
    }
  });
});
