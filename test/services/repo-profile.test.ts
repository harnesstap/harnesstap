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

  it("detects project-config when apm.yml exists", () => {
    const root = createTempDir("repo-profile-project-config");
    writeTextFile(
      join(root, "apm.yml"),
      `name: demo
version: "1.0.0"
`,
    );

    const result = classifyRepo(root);
    expect(result.profiles).toContain("project-config");
    expect(result.primary).toBe("project-config");
  });
});
