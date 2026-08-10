import { describe, expect, it } from "bun:test";
import { createPlugin, setPluginTags } from "../../../src/models/plugin-model.ts";
import { completeProfilePlugins } from "../../../src/services/completion/providers/profile-plugin.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";

describe("completeProfilePlugins", () => {
  it("returns only local profile plugin names", async () => {
    const context = await createInitializedTestContext("complete-profile-plugins");
    try {
      const profile = createPlugin({ name: "work" });
      setPluginTags(profile.id, ["profile"]);
      createPlugin({ name: "base" });

      const candidates = completeProfilePlugins({
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
