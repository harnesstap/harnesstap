import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";
import { GooseSerializer } from "../../src/platforms/goose.ts";
import { makeResource } from "../helpers/resources.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";

const GOOSE_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/goose-project", import.meta.url),
);

describe("GooseSerializer", () => {
  it("scans instructions, goosehints, skills, recipes, mcp, and plugin hooks", async () => {
    const serializer = new GooseSerializer();
    const resources = await serializer.scan(GOOSE_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining([
        "instruction",
        "skill",
        "command",
        "mcp_server",
        "hook",
      ]),
    );
    expect(resources.find((resource) => resource.name === "goosehints")).toBeDefined();
    expect(resources.find((resource) => resource.name === "review")).toBeDefined();
    expect(resources.find((resource) => resource.name === "security-audit")).toBeDefined();
    expect(resources.find((resource) => resource.name === "fetch")).toBeDefined();
  });

  it("serializes goose resources to native paths", async () => {
    const serializer = new GooseSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "instruction",
          name: "agents-instructions",
          content: "# Agents",
          source: "AGENTS.md",
        }),
        makeResource({
          type: "instruction",
          name: "goosehints",
          content: "Use pnpm",
          source: ".goosehints",
        }),
        makeResource({
          type: "skill",
          name: "review",
          description: "Review",
          content: "# Review",
        }),
        makeResource({
          type: "command",
          name: "security-audit",
          content: "version: 1.0.0\ntitle: Audit\n",
          source: "recipes/security-audit.yaml",
        }),
        makeResource({
          type: "mcp_server",
          name: "fetch",
          metadata: {
            transport: "stdio",
            command: "uvx",
            args: ["mcp-server-fetch"],
          },
        }),
        makeResource({
          type: "hook",
          name: "session-end",
          content: "echo done",
          metadata: {
            event: "SessionEnd",
            command: "echo done",
          },
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".goosehints",
        ".agents/skills/review/SKILL.md",
        "recipes/security-audit.yaml",
        ".config/goose/config.yaml",
        ".agents/plugins/harnessdeck-layer/hooks/hooks.json",
      ]),
    );

    const config = parse(
      files.find((file) => file.path === ".config/goose/config.yaml")?.content ?? "",
    ) as { extensions?: Record<string, { type?: string; cmd?: string }> };
    expect(config.extensions?.fetch?.type).toBe("stdio");
    expect(config.extensions?.fetch?.cmd).toBe("uvx");
  });

  it("scans legacy .goose/skills path via registry alternates", async () => {
    const projectDir = createTempDir("goose-legacy-skills");

    try {
      writeTextFile(
        join(projectDir, ".goose", "skills", "legacy", "SKILL.md"),
        "---\nname: legacy\ndescription: Legacy skill\n---\n\nBody\n",
      );

      const resources = await new GooseSerializer().scan(projectDir);
      expect(resources.some((resource) => resource.name === "legacy")).toBe(true);
    } finally {
      cleanupDir(projectDir);
    }
  });
});

describe("goose platform registry", () => {
  it("uses recommended skill paths and goosehints alternates", async () => {
    const registry = await import("../../src/platforms/registry.ts");
    const goose = registry.getPlatform("goose");

    expect(goose?.projectPaths.skills).toBe(".agents/skills/");
    expect(goose?.projectPaths.pathAlternates?.skills).toEqual([".goose/skills/"]);
    expect(goose?.projectPaths.pathAlternates?.instructions).toEqual([".goosehints"]);
    expect(goose?.globalPaths.skills).toBe("~/.agents/skills/");
    expect(goose?.supports.has("hooks")).toBe(true);
    expect(goose?.supports.has("commands")).toBe(true);
  });
});
