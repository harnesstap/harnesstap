import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { GeminiCliSerializer } from "../../src/platforms/gemini-cli.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const GEMINI_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/ponytail/gemini", import.meta.url),
);

describe("GeminiCliSerializer", () => {
  it("reads gemini-extension.json contextFileName and repo-root skills", async () => {
    const serializer = new GeminiCliSerializer();
    const resources = await serializer.scan(GEMINI_FIXTURE_DIR);

    expect(resources.some((r) => r.type === "instruction")).toBe(true);
    expect(resources.some((r) => r.type === "skill" && r.name === "ponytail")).toBe(
      true,
    );

    const instruction = resources.find((r) => r.type === "instruction");
    expect(instruction?.name).toBe("gemini-instructions");
    expect(instruction?.source).toBe("AGENTS.md");

    const command = resources.find((r) => r.type === "command");
    expect(command?.name).toBe("ponytail");
    expect(command?.metadata).toEqual(
      expect.objectContaining({ format: "toml" }),
    );
    expect(command?.description).toBe(
      "Switch ponytail intensity level (lite/full/ultra/off)",
    );
  });

  it("scans .agents/skills and commands/*.md", async () => {
    const projectDir = createTempDir("gemini-scan");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Gemini instructions");
      writeTextFile(
        join(projectDir, ".agents", "skills", "research", "SKILL.md"),
        "---\nname: research\ndescription: Research helper\n---\n# Research\n",
      );
      writeTextFile(
        join(projectDir, "commands", "deploy.md"),
        "# Deploy\n\nDeploy the app.\n",
      );

      const serializer = new GeminiCliSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources.find((r) => r.type === "skill")?.name).toBe("research");
      expect(resources.find((r) => r.type === "command")?.name).toBe("deploy");
      expect(resources.find((r) => r.type === "command")?.metadata).toEqual(
        expect.objectContaining({ format: "md" }),
      );
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("serializes instructions, skills, and commands with extension manifest", async () => {
    const serializer = new GeminiCliSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "instruction",
          name: "gemini-instructions",
          content: "# Ponytail",
          metadata: {
            contextFileName: "AGENTS.md",
            extension: {
              name: "ponytail",
              version: "4.6.0",
              description: "Lazy senior dev mode.",
            },
          },
        }),
        makeResource({
          type: "skill",
          name: "ponytail",
          description: "Lazy mode",
          content: "# Ponytail skill",
        }),
        makeResource({
          type: "command",
          name: "ponytail",
          description: "Switch ponytail intensity level",
          content: "Switch to ponytail {{args}} mode.",
          metadata: { format: "toml" },
          source: "commands/ponytail.toml",
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        "gemini-extension.json",
        ".agents/skills/ponytail/SKILL.md",
        "commands/ponytail.toml",
      ]),
    );

    const manifest = files.find((file) => file.path === "gemini-extension.json");
    expect(manifest).toBeDefined();
    if (!manifest) throw new Error("Expected gemini-extension.json");
    expect(JSON.parse(manifest.content)).toEqual({
      name: "ponytail",
      version: "4.6.0",
      description: "Lazy senior dev mode.",
      contextFileName: "AGENTS.md",
    });

    const command = files.find((file) => file.path === "commands/ponytail.toml");
    expect(command?.content).toContain('description = "Switch ponytail intensity level"');
    expect(command?.content).toContain("prompt = ");
  });

  it("serializes global skills into global paths", async () => {
    const serializer = new GeminiCliSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
      ],
      ".",
      { target: "global" },
    );

    expect(files.map((file) => file.path)).toEqual([
      ".gemini/skills/research/SKILL.md",
    ]);
    expect(files.find((file) => file.path === "gemini-extension.json")).toBeUndefined();
  });

  it("skips malformed gemini-extension.json gracefully", async () => {
    const projectDir = createTempDir("gemini-malformed");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Gemini instructions");
      writeTextFile(join(projectDir, "gemini-extension.json"), "not valid json {{{");

      const serializer = new GeminiCliSerializer();
      const resources = await serializer.scan(projectDir);

      expect(resources.find((r) => r.type === "instruction")?.source).toBe(
        "AGENTS.md",
      );
    } finally {
      cleanupDir(projectDir);
    }
  });
});
