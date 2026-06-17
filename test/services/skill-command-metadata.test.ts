import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanSkillCommandMetadataResources } from "../../src/services/skill-command-metadata.ts";

const fixture = join(
  import.meta.dirname,
  "../fixtures/plugin-import/impeccable-layout/.claude/skills/impeccable",
);

describe("skill-command-metadata", () => {
  it("imports namespaced commands from command-metadata.json", () => {
    const resources = scanSkillCommandMetadataResources({
      skillDir: fixture,
      skillName: "impeccable",
      rootPath: join(fixture, "../.."),
      relativePath: (rootPath, filePath) =>
        filePath.replace(`${rootPath}/`, ""),
    });

    expect(resources.map((resource) => resource.name)).toEqual([
      "impeccable:audit",
      "impeccable:polish",
    ]);

    const polish = resources.find((resource) => resource.name === "impeccable:polish");
    expect(polish?.description).toContain("Final quality pass");
    expect(polish?.content).toContain("Fixture reference doc for impeccable-layout");
    expect(polish?.metadata).toMatchObject({
      skill_command: true,
      skill_name: "impeccable",
      command_key: "polish",
      argument_hint: "[target]",
    });
  });
});
