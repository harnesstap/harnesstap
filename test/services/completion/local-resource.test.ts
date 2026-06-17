import { describe, expect, it } from "bun:test";
import { createResource } from "../../../src/models/resource.ts";
import { completeLocalResources } from "../../../src/services/completion/providers/local-resource.ts";
import { createInitializedTestContext } from "../../helpers/db.ts";
import { makeResourceInput } from "../../helpers/resources.ts";

describe("completeLocalResources", () => {
  it("returns resource selectors filtered by prefix", async () => {
    const context = await createInitializedTestContext("completion-local-resource");
    try {
      createResource(makeResourceInput({ name: "alpha-skill" }));
      createResource(makeResourceInput({ type: "rule", name: "beta-rule" }));

      const candidates = completeLocalResources({
        commandPath: ["resource", "show"],
        slot: "positional",
        positionalIndex: 0,
        prefix: "alp",
        localDataAvailable: true,
      });

      expect(candidates.map((entry) => entry.value)).toEqual(["alpha-skill"]);
    } finally {
      await context.cleanup();
    }
  });

  it("returns empty output when local data is unavailable", () => {
    expect(
      completeLocalResources({
        commandPath: ["resource", "show"],
        slot: "positional",
        positionalIndex: 0,
        prefix: "",
        localDataAvailable: false,
      }),
    ).toEqual([]);
  });
});
