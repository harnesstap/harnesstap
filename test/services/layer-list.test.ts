import { describe, expect, it } from "bun:test";
import { filterLocalLayers } from "../../src/services/layer-list.js";
import type { Layer } from "../../src/types.js";

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "layer-1",
    name: "team-stack",
    version: "1.0.0",
    org_slug: "",
    catalog_slug: "",
    description: "Team baseline layer",
    tags: ["core", "shared"],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("filterLocalLayers", () => {
  const layers = [
    makeLayer(),
    makeLayer({
      id: "layer-2",
      name: "demo-api",
      description: "API helpers",
      tags: ["api"],
    }),
  ];

  it("returns all layers when search is empty", () => {
    expect(filterLocalLayers(layers)).toHaveLength(2);
    expect(filterLocalLayers(layers, "   ")).toHaveLength(2);
  });

  it("filters by layer name", () => {
    expect(filterLocalLayers(layers, "demo")).toEqual([layers[1]]);
  });

  it("filters by description", () => {
    expect(filterLocalLayers(layers, "baseline")).toEqual([layers[0]]);
  });

  it("filters by tags", () => {
    expect(filterLocalLayers(layers, "api")).toEqual([layers[1]]);
    expect(filterLocalLayers(layers, "shared")).toEqual([layers[0]]);
  });

  it("is case-insensitive", () => {
    expect(filterLocalLayers(layers, "TEAM")).toEqual([layers[0]]);
  });
});
