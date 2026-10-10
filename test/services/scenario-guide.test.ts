import { describe, expect, it } from "bun:test";
import {
  listScenarioIds,
  listScenarioSummaries,
  loadScenarioGuide,
  parseScenarioId,
} from "../../src/services/scenario-guide.js";

describe("scenario guide", () => {
  it("lists all scenario ids", () => {
    const ids = listScenarioIds();
    expect(ids.length).toBe(38);
    expect(ids).toContain(11);
    expect(ids).toContain(28);
    expect(ids).toContain(40);
  });

  it("lists scenario summaries with titles", () => {
    const summaries = listScenarioSummaries();
    expect(summaries.length).toBe(38);
    const scenario11 = summaries.find((summary) => summary.id === 11);
    expect(scenario11?.title.toLowerCase()).toContain("catalog");
    expect(scenario11?.frequency).toBeTruthy();
  });

  it("loads scenario 11 with commands", () => {
    const guide = loadScenarioGuide(11);
    expect(guide.title.toLowerCase()).toContain("catalog");
    expect(guide.commands.some((command) => command.includes("engineering-foundation"))).toBe(
      true,
    );
  });

  it("loads scenario 17 with GitHub scenario 28 links and ASCII punctuation", () => {
    const guide = loadScenarioGuide(17);
    const joined = [
      guide.title,
      guide.status ?? "",
      ...guide.summaryLines,
      ...guide.commands,
    ].join("\n");
    expect(joined).not.toContain("—");
    expect(joined).not.toContain("./28-machine-migration.md");
    expect(joined).toContain(
      "https://github.com/harnesstap/harnesstap/blob/main/docs/scenarios/details/28-machine-migration.md",
    );
  });

  it("loads scenario 28 with migrate commands", () => {
    const guide = loadScenarioGuide(28);
    expect(guide.title.toLowerCase()).toContain("migration");
    expect(guide.commands.some((command) => command.includes("migrate export"))).toBe(
      true,
    );
  });

  it("parses scenario ids", () => {
    expect(parseScenarioId("11")).toBe(11);
    expect(() => parseScenarioId("nope")).toThrow(/Invalid scenario id/);
  });
});
