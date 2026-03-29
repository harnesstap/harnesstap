import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  PlatformDefinition,
  Resource,
  SerializedFile,
} from "../../src/types.ts";
import { BaseSerializer } from "../../src/platforms/base-serializer.ts";

const GENERIC_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/generic-project", import.meta.url),
);

class TestSerializer extends BaseSerializer {
  readonly platformId = "test";
  readonly platform: PlatformDefinition = {
    id: "test",
    name: "Test",
    supports: new Set(),
    projectPaths: {},
    globalPaths: {},
  };

  async scan(): Promise<Resource[]> {
    return [];
  }

  async serialize(): Promise<SerializedFile[]> {
    return [];
  }

  parse(content: string) {
    return this.parseFrontmatter(content);
  }

  emit(data: Record<string, unknown>, content: string) {
    return this.emitFrontmatter(data, content);
  }

  scanSkills(projectRoot: string, skillsDir: string) {
    return this.scanSkillsDir(projectRoot, skillsDir);
  }
}

describe("BaseSerializer", () => {
  it("round-trips frontmatter and omits empty metadata", () => {
    const serializer = new TestSerializer();
    const emitted = serializer.emit(
      { name: "alpha", description: "Alpha" },
      "# Body",
    );

    expect(emitted).toContain("name: alpha");
    expect(emitted).toContain("# Body");
    expect(serializer.parse(emitted)).toEqual({
      data: {
        description: "Alpha",
        name: "alpha",
      },
      content: "# Body\n",
    });
    expect(serializer.emit({}, "# Plain")).toBe("# Plain");
  });

  it("scans skill directories with frontmatter metadata", () => {
    const serializer = new TestSerializer();

    expect(serializer.scanSkills(GENERIC_FIXTURE_DIR, ".agents/skills")).toEqual([
      expect.objectContaining({
        type: "skill",
        name: "research",
        description: "Research helper",
        source: ".agents/skills/research/SKILL.md",
      }),
    ]);
  });
});
