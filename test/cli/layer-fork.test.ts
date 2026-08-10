import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";
import {
  addResourceToLayer,
  createLayer,
  getLayerByName,
  getLayerResources,
} from "../../src/models/plugin-model.ts";
import { createResource } from "../../src/models/resource.ts";
import { addDependency, listDependencies } from "../../src/services/plugin-dependency.ts";
import { getLayerOrigin, setLayerOrigin } from "../../src/services/layer-origin.ts";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("fork-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seedUpstream(): void {
  const layer = createLayer({ name: "web-search", version: "1.2.0" });
  setLayerOrigin(layer.id, "upstream");
  addResourceToLayer(
    layer.id,
    createResource({
      type: "skill",
      name: "search",
      description: "",
      content: "S",
      metadata: {},
      source: "plugin",
      namespace: "web-search@anthropics",
    }).id,
  );
  createLayer({ name: "base", version: "1.0.0" });
  addDependency(layer.id, "base");
}

describe("layer fork", () => {
  it("creates an authored copy with the same resources and dependencies", async () => {
    seedUpstream();
    const result = await runCli(["layer", "fork", "web-search"]);
    expect(result.exitCode ?? 0).toBe(0);

    const fork = getLayerByName("web-search-fork");
    expect(fork).toBeDefined();
    if (!fork) return;
    expect(getLayerOrigin(fork.id)).toBe("authored");
    expect(getLayerResources(fork.id).map((r) => r.name)).toContain("search");
    expect(listDependencies(fork.id).map((d) => d.name)).toEqual(["base"]);
  });

  it("honors --as", async () => {
    seedUpstream();
    await runCli(["layer", "fork", "web-search", "--as", "my-search"]);
    expect(getLayerByName("my-search")).toBeDefined();
  });

  it("leaves the upstream layer untouched", async () => {
    seedUpstream();
    await runCli(["layer", "fork", "web-search"]);
    const upstream = getLayerByName("web-search", "1.2.0");
    expect(upstream).toBeDefined();
    if (!upstream) return;
    expect(getLayerOrigin(upstream.id)).toBe("upstream");
  });

  it("makes the fork editable", async () => {
    seedUpstream();
    await runCli(["layer", "fork", "web-search", "--as", "my-search"]);
    const result = await runCli([
      "layer",
      "edit",
      "my-search",
      "--remove",
      "skill:search",
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0).toBe(0);
  });

  it("refuses to fork an authored plugin", async () => {
    createLayer({ name: "mine" });
    const result = await runCli(["layer", "fork", "mine"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already authored");
  });

  it("emits JSON", async () => {
    seedUpstream();
    const result = await runCli(["layer", "fork", "web-search", "--format", "json"]);
    const payload = JSON.parse(result.stdout) as { name: string; origin: string };
    expect(payload).toMatchObject({ name: "web-search-fork", origin: "authored" });
  });
});
