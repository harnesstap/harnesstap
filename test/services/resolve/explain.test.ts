import { describe, expect, it } from "bun:test";
import {
  explainPayload,
  renderExplain,
} from "../../../src/services/resolve/explain.ts";
import type { ResolutionResult } from "../../../src/services/resolve/types.ts";

const result: ResolutionResult = {
  root: { name: "my-setup", version: "1.0.0", layerId: "L0", ephemeral: false },
  selected: [
    {
      name: "my-setup",
      version: "1.0.0",
      layerId: "L0",
      depth: 0,
      declarationIndex: 0,
      constraints: [],
      reason: "root",
      path: ["my-setup@1.0.0"],
    },
    {
      name: "base",
      version: "2.1.0",
      layerId: "L1",
      depth: 2,
      declarationIndex: 2,
      constraints: [
        {
          constraint: "^2.0.0",
          requirer: "team-standards@2.1.0",
          path: ["my-setup@1.0.0", "team-standards@2.1.0"],
        },
      ],
      reason: "mediation",
      path: ["my-setup@1.0.0", "team-standards@2.1.0"],
    },
  ],
  resources: [],
  decisions: [
    {
      key: "skill:alpha",
      winner: { layerName: "my-setup", layerVersion: "1.0.0", depth: 0 },
      losers: [{ layerName: "base", layerVersion: "2.1.0", depth: 2 }],
      reason: "nearest-to-root",
    },
  ],
  warnings: [],
};

describe("renderExplain", () => {
  it("names selected versions with the constraints that produced them", () => {
    const text = renderExplain(result);
    expect(text).toContain("base@2.1.0");
    expect(text).toContain("team-standards@2.1.0 → base ^2.0.0");
    expect(text).toContain("mediation");
  });

  it("names winner, loser, and reason for every resource decision", () => {
    const text = renderExplain(result);
    expect(text).toContain("skill:alpha");
    expect(text).toContain("my-setup@1.0.0");
    expect(text).toContain("base@2.1.0");
    expect(text).toContain("nearest to root");
  });
});

describe("explainPayload", () => {
  it("produces a JSON-serializable trail", () => {
    const payload = explainPayload(result);
    expect(payload.root).toEqual({ name: "my-setup", version: "1.0.0", ephemeral: false });
    expect(payload.selected[0]).toEqual({
      name: "base",
      version: "2.1.0",
      depth: 2,
      reason: "mediation",
      path: ["my-setup@1.0.0", "team-standards@2.1.0"],
      constraints: [
        { requirer: "team-standards@2.1.0", constraint: "^2.0.0" },
      ],
    });
    expect(payload.resources[0]?.reason).toBe("nearest-to-root");
  });
});
