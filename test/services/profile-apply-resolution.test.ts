import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
  setLayerTags,
} from "../../src/models/layer-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addLayerAttachment } from "../../src/services/layer-composition.ts";
import { applyProfileLayer } from "../../src/services/profile-apply.ts";
import { listGlobalApplySnapshots } from "../../src/models/global-apply-snapshot.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("profile-resolve-");
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("profile apply resolution", () => {
  it("lets the profile's own resource beat its dependency without ordering", async () => {
    const base = createLayer({ name: "base" });
    addResourceToLayer(
      base.id,
      createResource({
        type: "instruction",
        name: "context",
        description: "",
        content: "FROM-BASE",
        metadata: {},
        source: "test",
        namespace: "base",
      }).id,
    );
    const work = createLayer({ name: "work" });
    setLayerTags(work.id, ["profile"]);
    addResourceToLayer(
      work.id,
      createResource({
        type: "instruction",
        name: "context",
        description: "",
        content: "FROM-WORK",
        metadata: {},
        source: "test",
        namespace: "work",
      }).id,
    );
    const workLayer = getLayerByName("work");
    if (!workLayer) throw new Error("missing work");
    await addLayerAttachment({ layer: workLayer, selector: "layer:base" });

    await applyProfileLayer("work", {
      harness: "claude-code",
      conflictPolicy: "replace",
    });

    expect(
      readFileSync(join(ctx.homeDir, ".claude", "CLAUDE.md"), "utf8"),
    ).toContain("FROM-WORK");
  });

  it("records the resolved set on the global apply snapshot", async () => {
    createLayer({ name: "base" });
    const work = createLayer({ name: "work" });
    setLayerTags(work.id, ["profile"]);
    const workLayer = getLayerByName("work");
    if (!workLayer) throw new Error("missing work");
    await addLayerAttachment({ layer: workLayer, selector: "layer:base" });

    await applyProfileLayer("work", {
      harness: "claude-code",
      conflictPolicy: "replace",
    });

    const snapshot = listGlobalApplySnapshots()[0];
    expect(snapshot?.resolved_set).toContainEqual({
      name: "base",
      version: "1.0.0",
    });
  });
});
