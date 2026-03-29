import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CursorSerializer } from "../../src/platforms/cursor.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const CURSOR_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/cursor-project", import.meta.url),
);

describe("CursorSerializer", () => {
  it("scans legacy instructions, rules, and skills", async () => {
    const serializer = new CursorSerializer();
    const resources = await serializer.scan(CURSOR_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["instruction", "rule", "skill"]),
    );
    expect(resources.find((resource) => resource.type === "instruction")?.name).toBe(
      "cursorrules",
    );
    expect(resources.find((resource) => resource.type === "rule")?.metadata).toEqual({
      globs: ["src/**/*.ts"],
      always_apply: false,
    });
  });

  it("serializes supported Cursor resource types into rule files", async () => {
    const serializer = new CursorSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "instruction",
          name: "always",
          description: "Always-on guidance",
          content: "Always apply this",
        }),
        makeResource({
          type: "rule",
          name: "refactor",
          description: "Refactor rule",
          content: "Refactor carefully",
          metadata: { globs: ["src/**/*.ts"], always_apply: false },
        }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
        makeResource({
          type: "permission",
          name: "ignored",
          metadata: { action: "allow", pattern: "Read(*)" },
        }),
      ],
      ".",
    );

    expect(files).toHaveLength(3);
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        ".cursor/rules/always.mdc",
        ".cursor/rules/refactor.mdc",
        ".cursor/rules/research.mdc",
      ]),
    );
    expect(files.find((file) => file.path === ".cursor/rules/refactor.mdc")?.content).toContain(
      "globs: src/**/*.ts",
    );
  });

  it("skips malformed rule frontmatter instead of aborting the scan", async () => {
    const projectDir = createTempDir("cursor-malformed");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Project instructions");
      writeTextFile(
        join(projectDir, ".cursor", "rules", "broken.mdc"),
        "---\nalwaysApply: [\n---\nBroken rule\n",
      );
      writeTextFile(
        join(projectDir, ".cursor", "rules", "valid.mdc"),
        "---\ndescription: Valid rule\nalwaysApply: false\nglobs: src/**/*.ts\n---\nUse tests\n",
      );

      const serializer = new CursorSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
          expect.objectContaining({ type: "rule", name: "valid" }),
        ]),
      );
      expect(resources.find((resource) => resource.name === "broken")).toBeUndefined();
    } finally {
      cleanupDir(projectDir);
    }
  });
});
