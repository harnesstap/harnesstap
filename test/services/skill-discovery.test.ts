import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { discoverSkillPackage } from "../../src/services/skill-discovery.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-discovery", () => {
  it("finds flat and nested skills under skills/", () => {
    const found = discoverSkillPackage(fixture);
    expect(found.map((s) => s.name).sort()).toEqual(["caveman", "tdd", "triage"]);
  });

  it("assigns category from path segment", () => {
    const found = discoverSkillPackage(fixture);
    expect(found.find((s) => s.name === "tdd")).toMatchObject({
      category: "engineering",
      skillDirRelative: "skills/engineering/tdd",
    });
    expect(found.find((s) => s.name === "caveman")).toMatchObject({
      category: "general",
      skillDirRelative: "skills/caveman",
    });
  });
});
