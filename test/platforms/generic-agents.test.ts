import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { GenericAgentsSerializer } from "../../src/platforms/generic-agents.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const GENERIC_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/generic-project", import.meta.url),
);

describe("GenericAgentsSerializer", () => {
  it("scans instructions and skills for generic .agents platforms", async () => {
    const serializer = new GenericAgentsSerializer("warp");
    const resources = await serializer.scan(GENERIC_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["instruction", "skill"]),
    );
    expect(resources.find((resource) => resource.type === "instruction")?.name).toBe(
      "warp-instructions",
    );
  });

  it("serializes instructions, rules, and skills", async () => {
    const serializer = new GenericAgentsSerializer("warp");
    const files = await serializer.serialize(
      [
        makeResource({ type: "instruction", name: "warp", content: "# Warp" }),
        makeResource({ type: "rule", name: "api", content: "Use Zod" }),
        makeResource({
          type: "skill",
          name: "research",
          description: "Research helper",
          content: "# Research",
        }),
      ],
      ".",
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", ".agents/skills/research/SKILL.md"]),
    );
    expect(files.find((file) => file.path === "AGENTS.md")?.content).toContain("## api");
  });

  it("serializes global generic skills into their configured global path", async () => {
    const serializer = new GenericAgentsSerializer("amp");
    const files = await (serializer as unknown as {
      serialize: (
        resources: ReturnType<typeof makeResource>[],
        root: string,
        options: { target: "global" },
      ) => Promise<Array<{ path: string; content: string }>>;
    }).serialize(
      [
        makeResource({ type: "instruction", name: "amp", content: "# Amp" }),
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
      ".config/agents/skills/research/SKILL.md",
    ]);
  });

  it("skips malformed skill frontmatter for generic platforms", async () => {
    const projectDir = createTempDir("generic-malformed");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Warp instructions");
      writeTextFile(
        join(projectDir, ".agents", "skills", "broken", "SKILL.md"),
        "---\nname: broken\ndescription: [\n---\nBroken skill\n",
      );

      const serializer = new GenericAgentsSerializer("warp");
      const resources = await serializer.scan(projectDir);

      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "instruction", source: "AGENTS.md" }),
        ]),
      );
      expect(resources.find((resource) => resource.type === "skill")).toBeUndefined();
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("scans and serializes antigravity workflows as commands", async () => {
    const projectDir = createTempDir("antigravity-workflows");

    try {
      writeTextFile(join(projectDir, "AGENTS.md"), "# Antigravity");
      writeTextFile(
        join(projectDir, ".agents/workflows/ship.md"),
        "# Ship\n\nRun preflight then open a PR.\n",
      );
      writeTextFile(
        join(projectDir, ".agents/mcp_config.json"),
        JSON.stringify({
          mcpServers: {
            docs: { command: "docs-mcp", args: [] },
          },
        }),
      );

      const serializer = new GenericAgentsSerializer("antigravity");
      const resources = await serializer.scan(projectDir);

      expect(resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "command",
            name: "ship",
            source: ".agents/workflows/ship.md",
          }),
          expect.objectContaining({
            type: "mcp_server",
            name: "docs",
            source: ".agents/mcp_config.json",
          }),
        ]),
      );

      const files = await serializer.serialize(
        [
          makeResource({
            type: "command",
            name: "ship",
            content: "# Ship\n\nRun preflight then open a PR.\n",
          }),
        ],
        ".",
      );

      expect(files).toEqual([
        {
          path: ".agents/workflows/ship.md",
          content: "# Ship\n\nRun preflight then open a PR.\n",
        },
      ]);
    } finally {
      cleanupDir(projectDir);
    }
  });
});
