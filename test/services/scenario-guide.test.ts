import { describe, expect, it } from "bun:test";
import { loadScenarioGuide, listScenarioIds, parseScenarioId } from "../../src/services/scenario-guide.js";

describe("scenario guide", () => {
  it("lists all scenario ids", () => {
    const ids = listScenarioIds();
    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(ids).toContain(11);
    expect(ids).toContain(29);
  });

  it("loads scenario 11 with commands", () => {
    const guide = loadScenarioGuide(11);
    expect(guide.title.toLowerCase()).toContain("catalog");
    expect(guide.commands.some((command) => command.includes("engineering-foundation"))).toBe(
      true,
    );
  });

  it("loads scenario 29 with deck apply commands", () => {
    const guide = loadScenarioGuide(29);
    expect(guide.title.toLowerCase()).toContain("deck");
    expect(guide.commands.some((command) => command.includes("deck apply"))).toBe(
      true,
    );
  });

  it("parses scenario ids", () => {
    expect(parseScenarioId("11")).toBe(11);
    expect(() => parseScenarioId("nope")).toThrow(/Invalid scenario id/);
  });
});
