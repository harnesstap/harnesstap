import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CodexSerializer } from "../../src/platforms/codex.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const CODEX_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/codex-project", import.meta.url),
);

describe("CodexSerializer", () => {
  it("scans instructions, skills, and agents", async () => {
    const serializer = new CodexSerializer();
    const resources = await serializer.scan(CODEX_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["instruction", "skill", "agent"]),
    );
    expect(resources.find((resource) => resource.type === "agent")?.name).toBe("reviewer");
  });

  it("serializes instructions, rules, skills, and agents", async () => {
    const serializer = new CodexSerializer();
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "codex", content: "# Codex" }),
        makeResource({ type: "rule", name: "api", content: "Use Zod" }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "agent",
          name: "reviewer",
          content: 'name = "reviewer"\n',
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".agents/skills/research/SKILL.md",
        ".codex/agents/reviewer.toml",
      ]),
    );
    expect(files.find((file) => file.path === "AGENTS.md")?.content).toContain("## api");
  });

  it("skips malformed skill frontmatter instead of aborting the scan", async () => {
    const projectDir = createTempDir("codex-malformed");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Codex instructions");
      writeTextFile(
        join(projectDir, ".agents", "skills", "broken", "SKILL.md"),
        "---\nname: broken\ndescription: [\n---\nBroken skill\n",
      );
      writeTextFile(join(projectDir, ".codex", "agents", "reviewer.toml"), 'name = "reviewer"\n');

      const serializer = new CodexSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({ type: "agent", name: "reviewer" }),
        ]),
      );
      expect(resources.find((resource) => resource.type === "skill")).toBeUndefined();
    } finally {
      cleanupDir(projectDir);
    }
  });
});
