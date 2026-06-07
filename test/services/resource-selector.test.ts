import { describe, expect, it } from "bun:test";
import { parseResourceSelector } from "../../src/services/resource-selector.ts";

describe("parseResourceSelector", () => {
  it("parses bare name", () => {
    expect(parseResourceSelector("brainstorming")).toEqual({
      type: undefined,
      name: "brainstorming",
      namespace: "",
    });
  });

  it("parses type:name@namespace", () => {
    expect(parseResourceSelector("skill:brainstorming@cursor-team-kit")).toEqual({
      type: "skill",
      name: "brainstorming",
      namespace: "cursor-team-kit",
    });
  });

  it("parses name@namespace", () => {
    expect(parseResourceSelector("brainstorming@cursor-team-kit")).toEqual({
      type: undefined,
      name: "brainstorming",
      namespace: "cursor-team-kit",
    });
  });
});
