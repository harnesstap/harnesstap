import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { classifyRepo } from "../../src/services/repo-profile.ts";
import { createTempDir, writeTextFile } from "../helpers/fs.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("repo-profile", () => {
  it("detects skill-package for mattpocock-style repo", () => {
    expect(classifyRepo(fixture)).toEqual({
      primary: "skill-package",
      profiles: expect.arrayContaining(["skill-package", "plugin-source"]),
    });
  });

  it("detects project-config when .harnessdeck/config.toml exists", () => {
    const root = createTempDir("repo-profile-project-config");
    mkdirSync(join(root, ".harnessdeck"), { recursive: true });
    writeTextFile(
      join(root, ".harnessdeck", "config.toml"),
      `schema = "urn:harnesstap:project:v1"
version = 1
`,
    );

    const result = classifyRepo(root);
    expect(result.profiles).toContain("project-config");
    expect(result.primary).toBe("project-config");
  });
});
