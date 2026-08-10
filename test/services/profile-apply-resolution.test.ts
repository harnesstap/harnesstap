import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import {
  addResourceToPlugin,
  createPlugin,
  getPluginByName,
  setPluginTags,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addPluginAttachment } from "../../src/services/plugin-composition.ts";
import { applyProfilePlugin } from "../../src/services/profile-apply.ts";
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
    const base = createPlugin({ name: "base" });
    addResourceToPlugin(
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
    const work = createPlugin({ name: "work" });
    setPluginTags(work.id, ["profile"]);
    addResourceToPlugin(
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
    const workPlugin = getPluginByName("work");
    if (!workPlugin) throw new Error("missing work");
    await addPluginAttachment({ plugin: workPlugin, selector: "plugin:base" });

    await applyProfilePlugin("work", {
      harness: "claude-code",
      conflictPolicy: "replace",
    });

    expect(
      readFileSync(join(ctx.homeDir, ".claude", "CLAUDE.md"), "utf8"),
    ).toContain("FROM-WORK");
  });

  it("records the resolved set on the global apply snapshot", async () => {
    createPlugin({ name: "base" });
    const work = createPlugin({ name: "work" });
    setPluginTags(work.id, ["profile"]);
    const workPlugin = getPluginByName("work");
    if (!workPlugin) throw new Error("missing work");
    await addPluginAttachment({ plugin: workPlugin, selector: "plugin:base" });

    await applyProfilePlugin("work", {
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
