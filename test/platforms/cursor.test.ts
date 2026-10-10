import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { CursorSerializer } from "../../src/platforms/cursor.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const CURSOR_FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/cursor-project", import.meta.url),
);

describe("CursorSerializer", () => {
  it("scans legacy instructions, rules, skills, and MCP servers", async () => {
    const serializer = new CursorSerializer();
    const resources = await serializer.scan(CURSOR_FIXTURE_DIR);

    expect(resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["instruction", "rule", "skill", "mcp_server"]),
    );
    expect(resources.find((resource) => resource.type === "instruction")?.name).toBe(
      "cursorrules",
    );
    expect(resources.find((resource) => resource.type === "rule")?.metadata).toEqual({
      globs: ["src/**/*.ts"],
      always_apply: false,
    });

    const localMcp = resources.find(
      (resource) => resource.type === "mcp_server" && resource.name === "local-tool",
    );
    expect(localMcp?.source).toBe(".cursor/mcp.json");
    expect(localMcp?.metadata).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { API_KEY: "${API_KEY}" },
      connection_type: "stdio",
      env_file: ".env.mcp",
    });

    const remoteMcp = resources.find(
      (resource) => resource.type === "mcp_server" && resource.name === "remote-api",
    );
    expect(remoteMcp?.metadata).toEqual({
      transport: "http",
      url: "https://mcp.example.com/v1",
      headers: { Authorization: "Bearer ${TOKEN}" },
      auth: {
        CLIENT_ID: "${CLIENT_ID}",
        scopes: ["read"],
      },
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
        ".agents/skills/research/SKILL.md",
      ]),
    );
    expect(files.find((file) => file.path === ".cursor/rules/refactor.mdc")?.content).toContain(
      "globs: src/**/*.ts",
    );
  });

  it("defaults skill emission to agents-skills (one surface)", async () => {
    const serializer = new CursorSerializer();
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
    );

    expect(files.map((file) => file.path)).toEqual([".agents/skills/research/SKILL.md"]);
    expect(files.some((file) => file.path.endsWith(".mdc"))).toBe(false);
  });

  it("agent-requested mode writes skills as .cursor/rules mdc files", async () => {
    const serializer = new CursorSerializer();
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
      { skillCursorMode: "agent-requested" },
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".cursor/rules/research.mdc");
    expect(files[0]?.content).toContain("alwaysApply: false");
  });

  it("always-on mode sets alwaysApply true on skill rules", async () => {
    const serializer = new CursorSerializer();
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
      { skillCursorMode: "always-on" },
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".cursor/rules/research.mdc");
    expect(files[0]?.content).toContain("alwaysApply: true");
  });

  it("agents-skills mode writes project skills under .agents/skills/", async () => {
    const serializer = new CursorSerializer();
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
      { skillCursorMode: "agents-skills" },
    );

    expect(files.map((file) => file.path)).toEqual([".agents/skills/research/SKILL.md"]);
  });

  it("serializes global Cursor skills into the global layout", async () => {
    const serializer = new CursorSerializer();
    const files = await (serializer as unknown as {
      serialize: (
        resources: ReturnType<typeof makeResource>[],
        root: string,
        options: { target: "global" },
      ) => Promise<Array<{ path: string; content: string }>>;
    }).serialize(
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

    expect(files.map((file) => file.path)).toEqual([".cursor/skills/research/SKILL.md"]);
  });

  it("keeps SKILL.md body when emitting global Cursor skills", async () => {
    const serializer = new CursorSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "skill",
          name: "brainstorming",
          description: "You MUST use this before any creative work",
          content: "# Brainstorming\n\nDo not skip this skill.\n",
        }),
      ],
      ".",
      { target: "global" },
    );

    const skillMd = files.find(
      (file) => file.path === ".cursor/skills/brainstorming/SKILL.md",
    );
    expect(skillMd?.content).toContain("name: brainstorming");
    expect(skillMd?.content).toContain("# Brainstorming");
    expect(skillMd?.content).toContain("Do not skip this skill.");
  });

  it("copies companion skill files from a tilde-prefixed source under the home root", async () => {
    const homeDir = createTempDir("cursor-skill-aux");

    try {
      writeTextFile(
        join(homeDir, ".cursor/skills/ship/SKILL.md"),
        "---\nname: ship\ndescription: Ship it\n---\n# Ship\n",
      );
      writeTextFile(join(homeDir, ".cursor/skills/ship/scripts/run.sh"), "#!/bin/sh\necho hi\n");

      const serializer = new CursorSerializer();
      const files = await serializer.serialize(
        [
          makeResource({
            type: "skill",
            name: "ship",
            description: "Ship it",
            content: "# Ship\n",
            source: "~/.cursor/skills/ship/SKILL.md",
            metadata: { scripts: ["run.sh"] },
          }),
        ],
        homeDir,
        { target: "global", projectRoot: homeDir },
      );

      expect(files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          ".cursor/skills/ship/SKILL.md",
          ".cursor/skills/ship/scripts/run.sh",
        ]),
      );
      expect(
        files.find((file) => file.path === ".cursor/skills/ship/scripts/run.sh")?.content,
      ).toContain("echo hi");
    } finally {
      cleanupDir(homeDir);
    }
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

  it("serializes MCP servers to .cursor/mcp.json", async () => {
    const serializer = new CursorSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "mcp_server",
          name: "local-tool",
          metadata: {
            transport: "stdio",
            command: "npx",
            args: ["-y", "server"],
            env: { API_KEY: "${API_KEY}" },
            env_file: ".env.mcp",
          },
        }),
        makeResource({
          type: "mcp_server",
          name: "remote-api",
          metadata: {
            transport: "http",
            url: "https://mcp.example.com/v1",
            headers: { Authorization: "Bearer ${TOKEN}" },
            auth: { CLIENT_ID: "${CLIENT_ID}", scopes: ["read"] },
          },
        }),
      ],
      ".",
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(".cursor/mcp.json");
    expect(JSON.parse(files[0]?.content ?? "{}")).toEqual({
      mcpServers: {
        "local-tool": {
          type: "stdio",
          command: "npx",
          args: ["-y", "server"],
          env: { API_KEY: "${API_KEY}" },
          envFile: ".env.mcp",
        },
        "remote-api": {
          url: "https://mcp.example.com/v1",
          headers: { Authorization: "Bearer ${TOKEN}" },
          auth: { CLIENT_ID: "${CLIENT_ID}", scopes: ["read"] },
        },
      },
    });
  });

  it("serializes global MCP servers to ~/.cursor/mcp.json", async () => {
    const serializer = new CursorSerializer();
    const files = await serializer.serialize(
      [
        makeResource({
          type: "mcp_server",
          name: "demo",
          metadata: { transport: "stdio", command: "npx", args: ["demo-server"] },
        }),
      ],
      ".",
      { target: "global" },
    );

    expect(files.map((file) => file.path)).toEqual([".cursor/mcp.json"]);
    expect(JSON.parse(files[0]?.content ?? "{}")).toEqual({
      mcpServers: {
        demo: {
          type: "stdio",
          command: "npx",
          args: ["demo-server"],
        },
      },
    });
  });

  it("scans global MCP servers from ~/.cursor/mcp.json", async () => {
    const homeDir = createTempDir("cursor-global-mcp");

    try {
      writeTextFile(
        join(homeDir, ".cursor", "mcp.json"),
        JSON.stringify({
          mcpServers: {
            global: { type: "stdio", command: "node", args: ["global-server.js"] },
          },
        }),
      );

      const serializer = new CursorSerializer();
      const resources = await serializer.scanGlobal(homeDir);
      const mcp = resources.find((resource) => resource.type === "mcp_server");

      expect(mcp?.name).toBe("global");
      expect(mcp?.source).toBe("~/.cursor/mcp.json");
      expect(mcp?.metadata).toEqual({
        transport: "stdio",
        command: "node",
        args: ["global-server.js"],
        connection_type: "stdio",
      });
    } finally {
      cleanupDir(homeDir);
    }
  });

  it("scans installed host plugins from ~/.cursor/plugins", async () => {
    const fixtureHome = fileURLToPath(
      new URL("../fixtures/cursor-plugins-home", import.meta.url),
    );
    const serializer = new CursorSerializer();
    const resources = await serializer.scanGlobal(fixtureHome);
    const pins = resources.filter((resource) => resource.type === "plugin");
    expect(pins.map((pin) => pin.origin_ref).sort()).toEqual([
      "active-plugin@cursor-public",
      "homemade@local",
    ]);
  });

  it("scans and serializes subagent files under .cursor/agents/", async () => {
    const projectDir = createTempDir("cursor-agents");

    try {
      writeTextFile(
        join(projectDir, ".cursor", "agents", "reviewer.md"),
        [
          "---",
          "name: reviewer",
          "description: Review changes",
          "readonly: true",
          "---",
          "Review carefully.",
        ].join("\n"),
      );

      const serializer = new CursorSerializer();
      const scanned = await serializer.scan(projectDir);
      const agent = scanned.find((resource) => resource.type === "agent");
      expect(agent?.name).toBe("reviewer");
      expect(agent?.metadata).toMatchObject({ readonly: true });

      const files = await serializer.serialize(
        [
          makeResource({
            type: "agent",
            name: "api-designer",
            description: "API design",
            content: "Design contracts.",
            metadata: { sandbox_mode: "read-only", model: "gpt-5.4" },
          }),
        ],
        projectDir,
      );

      const emitted = files.find((file) => file.path.endsWith("api-designer.md"));
      expect(emitted?.content).toContain("readonly: true");
    } finally {
      cleanupDir(projectDir);
    }
  });
});
