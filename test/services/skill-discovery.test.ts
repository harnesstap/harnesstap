import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  it("reads descriptions that contain unquoted colons", () => {
    const root = mkdtempSync(join(tmpdir(), "ht-skill-colon-"));
    mkdirSync(join(root, "skills", "check-agent-compatibility"), { recursive: true });
    writeFileSync(
      join(root, "skills", "check-agent-compatibility", "SKILL.md"),
      [
        "---",
        "name: check-agent-compatibility",
        "description: Run the full repository compatibility pass: scanner score, startup path, validation loop, and docs reliability.",
        "---",
        "",
        "# Check",
        "",
      ].join("\n"),
    );

    const found = discoverSkillPackage(root);
    expect(found).toEqual([
      expect.objectContaining({
        name: "check-agent-compatibility",
        description:
          "Run the full repository compatibility pass: scanner score, startup path, validation loop, and docs reliability.",
        skillDirRelative: "skills/check-agent-compatibility",
      }),
    ]);
  });
});
