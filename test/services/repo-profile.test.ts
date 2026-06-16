import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { classifyRepo } from "../../src/services/repo-profile.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("repo-profile", () => {
  it("detects skill-package for mattpocock-style repo", () => {
    expect(classifyRepo(fixture)).toEqual({
      primary: "skill-package",
      profiles: expect.arrayContaining(["skill-package", "plugin-source"]),
    });
  });
});
