import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { addResourceToLayer, createLayer, getLayerByName } from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { createSnapshot } from "../../src/models/snapshot.ts";
import { upsertProject } from "../../src/models/project.ts";
import { addLayerAttachment } from "../../src/services/layer-composition.ts";
import { getLayerOverrides } from "../../src/services/layer-overrides.ts";
import { migrateOrderToOverrides } from "../../src/services/order-to-override-migration.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("order-migrate-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function skill(name: string, content: string, ns: string) {
  return createResource({
    type: "skill",
    name,
    description: "",
    content,
    metadata: {},
    source: "test",
    namespace: ns,
  });
}

describe("migrateOrderToOverrides", () => {
  it("synthesizes an override when the previous winner differs from resolution", async () => {
    // dep declares skill:alpha; root also declares skill:alpha.
    // Old ordered merge applied dep last, so dep won. Nearest-wins gives root.
    const dep = createLayer({ name: "dep" });
    const depSkill = skill("alpha", "FROM-DEP", "dep");
    addResourceToLayer(dep.id, depSkill.id);

    const root = createLayer({ name: "root" });
    const rootSkill = skill("alpha", "FROM-ROOT", "root");
    addResourceToLayer(root.id, rootSkill.id);
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:dep" });

    const project = upsertProject({
      git_origin: "github.com/acme/repo",
      name: "repo",
      local_path: ctx.projectDir,
    });
    createSnapshot({
      project_id: project.id,
      label: "Before applying: root",
      state: {
        layers: [rootLayer],
        resources: [depSkill],
        platform_files: {},
      },
    });

    const report = migrateOrderToOverrides();
    expect(report.projectsWithSnapshot).toBe(1);
    expect(report.overridesWritten).toContainEqual({
      root: "root",
      key: "skill:alpha",
      winner: "dep",
    });
    expect(getLayerOverrides(root.id).resources["skill:alpha"]).toBe("dep");
  });

  it("writes nothing when the previous winner already matches resolution", async () => {
    const dep = createLayer({ name: "dep" });
    addResourceToLayer(dep.id, skill("beta", "FROM-DEP", "dep").id);
    const root = createLayer({ name: "root" });
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:dep" });

    const project = upsertProject({
      git_origin: "github.com/acme/repo2",
      name: "repo2",
      local_path: ctx.projectDir,
    });
    createSnapshot({
      project_id: project.id,
      label: "Before applying: root",
      state: {
        layers: [rootLayer],
        resources: [],
        platform_files: {},
      },
    });

    const report = migrateOrderToOverrides();
    expect(report.overridesWritten).toEqual([]);
    expect(getLayerOverrides(root.id).resources).toEqual({});
  });

  it("warns for projects with no snapshot instead of guessing", async () => {
    const dep = createLayer({ name: "dep" });
    addResourceToLayer(dep.id, skill("alpha", "FROM-DEP", "dep").id);
    const root = createLayer({ name: "root" });
    addResourceToLayer(root.id, skill("alpha", "FROM-ROOT", "root").id);
    const rootLayer = getLayerByName("root");
    if (!rootLayer) throw new Error("missing root");
    await addLayerAttachment({ layer: rootLayer, selector: "layer:dep" });

    upsertProject({
      git_origin: "github.com/acme/repo3",
      name: "repo3",
      local_path: ctx.projectDir,
    });

    const report = migrateOrderToOverrides();
    expect(report.overridesWritten).toEqual([]);
    expect(report.warnings.some((w) => w.includes("skill:alpha"))).toBe(true);
    expect(report.warnings.some((w) => w.includes("--explain"))).toBe(true);
  });
});
