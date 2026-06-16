import { describe, expect, it } from "bun:test";
import { generateFiles } from "../../src/services/applier.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResource } from "../helpers/resources.ts";

const skillResources = [
  makeResource({
    type: "skill",
    name: "ponytail",
    description: "Ponytail portability skill",
    content: "# Ponytail\n\nAlways-on guidance.\n",
  }),
];

describe("instruction-tier skill emission", () => {
  it("emits windsurf skills as .windsurf/rules/{name}.md", async () => {
    const context = await createInitializedTestContext("instruction-tier-windsurf");

    try {
      const files = await generateFiles(skillResources, ["windsurf"], context.projectDir);
      const windsurf = files.find((r) => r.platformId === "windsurf");

      expect(windsurf?.files.some((f) => f.path === ".windsurf/rules/ponytail.md")).toBe(
        true,
      );
      expect(windsurf?.files.some((f) => f.path.includes(".agents/skills"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("emits cline skills as .clinerules/{name}.md", async () => {
    const context = await createInitializedTestContext("instruction-tier-cline");

    try {
      const files = await generateFiles(skillResources, ["cline"], context.projectDir);
      const cline = files.find((r) => r.platformId === "cline");

      expect(cline?.files.some((f) => f.path === ".clinerules/ponytail.md")).toBe(true);
      expect(cline?.files.some((f) => f.path.includes(".agents/skills"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("emits kiro skills as .kiro/steering/{name}.md", async () => {
    const context = await createInitializedTestContext("instruction-tier-kiro");

    try {
      const files = await generateFiles(skillResources, ["kiro"], context.projectDir);
      const kiro = files.find((r) => r.platformId === "kiro");

      expect(kiro?.files.some((f) => f.path === ".kiro/steering/ponytail.md")).toBe(true);
      expect(kiro?.files.some((f) => f.path.includes(".agents/skills"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("merges github-copilot skills into copilot-instructions.md", async () => {
    const context = await createInitializedTestContext("instruction-tier-copilot");

    try {
      const files = await generateFiles(
        skillResources,
        ["github-copilot"],
        context.projectDir,
      );
      const copilot = files.find((r) => r.platformId === "github-copilot");
      const instructions = copilot?.files.find(
        (f) => f.path === ".github/copilot-instructions.md",
      );

      expect(instructions?.content).toContain("## ponytail");
      expect(instructions?.content).toContain("Always-on guidance.");
      expect(copilot?.files.some((f) => f.path.includes(".agents/skills"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("merges gemini-cli skills into AGENTS.md", async () => {
    const context = await createInitializedTestContext("instruction-tier-gemini");

    try {
      const files = await generateFiles(
        skillResources,
        ["gemini-cli"],
        context.projectDir,
      );
      const gemini = files.find((r) => r.platformId === "gemini-cli");
      const agents = gemini?.files.find((f) => f.path === "AGENTS.md");

      expect(agents?.content).toContain("## ponytail");
      expect(agents?.content).toContain("Always-on guidance.");
      expect(gemini?.files.some((f) => f.path.includes(".agents/skills"))).toBe(false);
    } finally {
      await context.cleanup();
    }
  });

  it("still emits native skills for codex", async () => {
    const context = await createInitializedTestContext("instruction-tier-codex");

    try {
      const files = await generateFiles(skillResources, ["codex"], context.projectDir);
      const codex = files.find((r) => r.platformId === "codex");

      expect(codex?.files.some((f) => f.path === ".agents/skills/ponytail/SKILL.md")).toBe(
        true,
      );
    } finally {
      await context.cleanup();
    }
  });
});
