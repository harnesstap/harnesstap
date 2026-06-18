import { describe, expect, it } from "bun:test";
import { createLayer } from "../../src/models/layer-model.js";
import { createResource } from "../../src/models/resource.js";
import {
  toLayerChoices,
  toResourceChoices,
} from "../../src/services/completion/choices.js";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("completion choice builders", () => {
  it("maps local layers to searchable picker choices", async () => {
    const context = await createInitializedTestContext("completion-layer-choices");
    try {
      createLayer({ name: "engineering-foundation", version: "1.2.0", description: "Base layer" });

      expect(toLayerChoices()).toEqual([
        {
          name: "engineering-foundation@1.2.0",
          value: "engineering-foundation@1.2.0",
          description: "Base layer",
        },
      ]);
    } finally {
      await context.cleanup();
    }
  });

  it("maps local resources to searchable picker choices", async () => {
    const context = await createInitializedTestContext("completion-resource-choices");
    try {
      createResource(
        makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
      );

      expect(toResourceChoices()).toEqual([
        {
          name: "shared-skill",
          value: "shared-skill",
          description: "skill",
        },
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
