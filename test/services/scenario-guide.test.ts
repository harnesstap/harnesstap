import { describe, expect, it } from "bun:test";
import { catalogAliasHint, resolveCatalogLayerAlias } from "../../src/services/catalog-aliases.js";
import { loadScenarioGuide, listScenarioIds, parseScenarioId } from "../../src/services/scenario-guide.js";

describe("scenario guide", () => {
  it("lists all scenario ids", () => {
    const ids = listScenarioIds();
    expect(ids.length).toBeGreaterThanOrEqual(28);
    expect(ids).toContain(11);
  });

  it("loads scenario 11 with commands", () => {
    const guide = loadScenarioGuide(11);
    expect(guide.title.toLowerCase()).toContain("catalog");
    expect(guide.commands.some((command) => command.includes("engineering-foundation"))).toBe(
      true,
    );
  });

  it("parses scenario ids", () => {
    expect(parseScenarioId("11")).toBe(11);
    expect(() => parseScenarioId("nope")).toThrow(/Invalid scenario id/);
  });
});

describe("catalog aliases", () => {
  it("resolves legacy slugs", () => {
    expect(resolveCatalogLayerAlias("nextjs-fullstack")).toBe("frontend-engineer");
    expect(catalogAliasHint("nextjs-fullstack")).toContain("frontend-engineer");
  });
});
