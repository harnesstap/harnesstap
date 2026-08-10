import { describe, expect, it } from "bun:test";
import { createLayer, setLayerTags } from "../../../src/models/plugin-model.ts";
import { completeProfileLayers } from "../../../src/services/completion/providers/profile-layer.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";

describe("completeProfileLayers", () => {
  it("returns only local profile layer names", async () => {
    const context = await createInitializedTestContext("complete-profile-layers");
    try {
      const profile = createLayer({ name: "work" });
      setLayerTags(profile.id, ["profile"]);
      createLayer({ name: "base" });

      const candidates = completeProfileLayers({
        commandPath: ["profile", "use"],
        slot: "positional",
        positionalIndex: 0,
        prefix: "wo",
        localDataAvailable: true,
      });
      expect(candidates.map((candidate) => candidate.value)).toEqual(["work"]);
    } finally {
      await context.cleanup();
    }
  });
});
