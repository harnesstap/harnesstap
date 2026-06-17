import { describe, expect, it } from "bun:test";
import {
  addResourceToLayer,
  createLayer,
} from "../../../src/models/layer-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { completeLayerAttachment } from "../../../src/services/completion/providers/layer-attachment.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { makeResourceInput } from "../../helpers/resources.ts";

describe("completeLayerAttachment", () => {
  it("suggests typed resources and other layers for combine", async () => {
    const context = await createInitializedTestContext("completion-layer-attach-combine");
    try {
      const targetLayer = createLayer({ name: "target-layer", version: "1.0.0" });
      createLayer({ name: "dep-layer", version: "1.0.0" });
      const skill = createResource(makeResourceInput({ name: "combine-skill" }));

      const candidates = completeLayerAttachment({
        commandPath: ["layer", "combine"],
        slot: "positional",
        positionalIndex: 1,
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

  it("suggests current attachments for uncombine", async () => {
    const context = await createInitializedTestContext("completion-layer-attach-uncombine");
    try {
      const layer = createLayer({ name: "source-layer", version: "1.0.0" });
      const skill = createResource(makeResourceInput({ name: "attached-skill" }));
      addResourceToLayer(layer.id, skill.id);

      const candidates = completeLayerAttachment({
        commandPath: ["layer", "uncombine"],
        slot: "positional",
        positionalIndex: 1,
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
