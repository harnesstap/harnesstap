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

  it("scans legacy antigravity workflows and serializes commands as skills", async () => {
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

      expect(files).toHaveLength(1);
      expect(files[0]?.path).toBe(".agents/skills/ship/SKILL.md");
      expect(files[0]?.content).toMatch(/^---\nname: ship\ndescription: Alpha resource\n---\n/);
      expect(files[0]?.content).toContain("# Ship\n\nRun preflight then open a PR.");
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("does not let a command overwrite an antigravity skill of the same name", async () => {
    const serializer = new GenericAgentsSerializer("antigravity");
    const files = await serializer.serialize(
      [
        makeResource({ type: "skill", name: "ship", content: "# Skill" }),
        makeResource({ type: "command", name: "ship", content: "# Command" }),
      ],
      ".",
    );
    const skillFiles = files.filter((file) => file.path === ".agents/skills/ship/SKILL.md");
    expect(skillFiles).toHaveLength(1);
    expect(skillFiles[0]?.content).toContain("# Skill");
  });

  it("emits commands as global antigravity skills, never global workflows", async () => {
    const serializer = new GenericAgentsSerializer("antigravity");
    const files = await serializer.serialize(
      [makeResource({ type: "command", name: "ship", description: "Ship it", content: "Go" })],
      "/home/test",
      { target: "global" },
    );
    expect(files.map((file) => file.path)).toEqual([".gemini/skills/ship/SKILL.md"]);
    expect(files.some((file) => file.path.includes("workflows"))).toBe(false);
  });

  it("maps rule semantics to antigravity triggers", async () => {
    const serializer = new GenericAgentsSerializer("antigravity");
    const files = await serializer.serialize(
      [
        makeResource({
          type: "rule",
          name: "always",
          content: "Always",
          metadata: { globs: [], always_apply: true },
        }),
        makeResource({
          type: "rule",
          name: "ts",
          description: "TypeScript style",
          content: "Use strict",
          metadata: { globs: ["*.ts", "*.tsx"], always_apply: false },
        }),
        makeResource({
          type: "rule",
          name: "decide",
          description: "Database work",
          content: "Use migrations",
          metadata: { globs: [], always_apply: false },
        }),
      ],
      ".",
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    expect(byPath.get(".agents/rules/always.md")).toMatch(/^---\ntrigger: always_on\n/);
    const ts = byPath.get(".agents/rules/ts.md") ?? "";
    expect(ts).toMatch(/^---\ntrigger: glob\n/);
    expect(ts).toContain("description: TypeScript style");
    expect(ts).toMatch(/globs: ['"]?\*\.ts, \*\.tsx['"]?/);
    expect(byPath.get(".agents/rules/decide.md")).toMatch(
      /^---\ntrigger: model_decision\ndescription: Database work\n/,
    );
  });

  it("round-trips antigravity trigger frontmatter on scan", async () => {
    const projectDir = createTempDir("antigravity-trigger-scan");
    try {
      writeTextFile(
        join(projectDir, ".agents/rules/ts.md"),
        "---\ntrigger: glob\nglobs: \"*.ts, *.tsx\"\n---\nUse strict\n",
      );
      writeTextFile(
        join(projectDir, ".agents/rules/always.md"),
        "---\ntrigger: always_on\n---\nAlways\n",
      );
      const resources = await new GenericAgentsSerializer("antigravity").scan(projectDir);
      const rules = new Map(
        resources.filter((r) => r.type === "rule").map((r) => [r.name, r.metadata]),
      );
      expect(rules.get("ts")).toEqual({ globs: ["*.ts", "*.tsx"], always_apply: false });
      expect(rules.get("always")).toEqual({ globs: [], always_apply: true });
    } finally {
      cleanupDir(projectDir);
    }
  });

  it("writes roo rules as plain files under .roo/rules/ and never into .roomodes", async () => {
    const serializer = new GenericAgentsSerializer("roo");
    const files = await serializer.serialize(
      [
        makeResource({ type: "rule", name: "api", content: "Use Zod" }),
        makeResource({
          type: "rule",
          name: "ts",
          content: "Use strict",
          metadata: { globs: ["src/**/*.ts"], always_apply: false },
        }),
      ],
      ".",
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    expect(files.some((file) => file.path === ".roomodes")).toBe(false);
    expect(byPath.get(".roo/rules/api.md")).toBe("Use Zod");
    expect(byPath.get(".roo/rules/ts.md")).toBe(
      "Applies to files matching: src/**/*.ts\n\nUse strict",
    );
  });
});
