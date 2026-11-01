import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse as parseToml } from "smol-toml";
import { CodexSerializer } from "../../src/platforms/codex.ts";
import { CopilotSerializer } from "../../src/platforms/copilot.ts";
import { GeminiCliSerializer } from "../../src/platforms/gemini-cli.ts";
import { GenericAgentsSerializer } from "../../src/platforms/generic-agents.ts";
import { parseJsonObject } from "../../src/services/format-preserving-config.ts";
import {
  mcpServerMetadataEquivalent,
  parseMcpServerEntry,
} from "../../src/services/mcp-config-bridge.ts";
import type { McpServerMetadata, Resource } from "../../src/types.ts";
import { cleanupDir, createTempDir, writeTextFile } from "../helpers/fs.ts";
import { makeResource } from "../helpers/resources.ts";

const stdio: McpServerMetadata = {
  transport: "stdio",
  command: "npx",
  args: ["-y", "srv"],
  env: { TOKEN: "${TOKEN}" },
  enabled_tools: ["read", "list"],
  disabled_tools: ["delete"],
};
const http: McpServerMetadata = {
  transport: "http",
  url: "https://example.com/mcp",
  headers: { Authorization: "Bearer ${TOKEN}" },
};

function mcp(name: string, metadata: McpServerMetadata): Resource {
  return makeResource({ type: "mcp_server", name, content: "", metadata });
}

async function withProject(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = createTempDir("harness-gap");
  try {
    await run(dir);
  } finally {
    cleanupDir(dir);
  }
}

function jsonAt(files: { path: string; content: string }[], path: string): Record<string, unknown> {
  const file = files.find((f) => f.path === path);
  expect(file).toBeDefined();
  const parsed = parseJsonObject(file?.content ?? "");
  expect(parsed).not.toBeNull();
  return parsed ?? {};
}

describe("shared MCP tool filters", () => {
  it("reads every harness spelling into enabled_tools and disabled_tools", () => {
    expect(parseMcpServerEntry({ command: "x", includeTools: ["a"], excludeTools: ["b"] })).toMatchObject({
      enabled_tools: ["a"],
      disabled_tools: ["b"],
    });
    expect(parseMcpServerEntry({ command: "x", enabled_tools: ["a"], disabled_tools: ["b"] })).toMatchObject({
      enabled_tools: ["a"],
      disabled_tools: ["b"],
    });
    expect(parseMcpServerEntry({ command: "x", disabledTools: ["b"] })?.disabled_tools).toEqual(["b"]);
  });

  it("treats servers with different filters as different", () => {
    expect(mcpServerMetadataEquivalent({ command: "x" }, { command: "x", disabled_tools: ["b"] })).toBe(
      false,
    );
  });

  it("emits enabled_tools and disabled_tools in Codex config.toml and scans them back", async () => {
    await withProject(async (dir) => {
      const serializer = new CodexSerializer();
      const files = await serializer.serialize([mcp("srv", stdio)], dir);
      const config = files.find((f) => f.path.endsWith("config.toml"));
      expect(config).toBeDefined();
      const toml = parseToml(config?.content ?? "") as {
        mcp_servers: Record<string, Record<string, unknown>>;
      };
      expect(toml.mcp_servers.srv?.enabled_tools).toEqual(["read", "list"]);
      expect(toml.mcp_servers.srv?.disabled_tools).toEqual(["delete"]);

      writeTextFile(join(dir, config?.path ?? ""), config?.content ?? "");
      const scanned = await serializer.scan(dir);
      const server = scanned.find((r) => r.type === "mcp_server" && r.name === "srv");
      expect(server?.metadata).toMatchObject({
        enabled_tools: ["read", "list"],
        disabled_tools: ["delete"],
      });
    });
  });
});

describe("Gemini CLI MCP in .gemini/settings.json", () => {
  it("merges servers into existing settings and keeps user keys", async () => {
    await withProject(async (dir) => {
      writeTextFile(
        join(dir, ".gemini/settings.json"),
        [
          "{",
          "  // user comment",
          '  "theme": "GitHub",',
          '  "mcpServers": { "user": { "command": "mine" } }',
          "}",
          "",
        ].join("\n"),
      );
      const files = await new GeminiCliSerializer().serialize(
        [mcp("srv", stdio), mcp("remote", http)],
        dir,
      );
      const raw = files.find((f) => f.path === ".gemini/settings.json")?.content ?? "";
      expect(raw).toContain("// user comment");
      const settings = jsonAt(files, ".gemini/settings.json");
      expect(settings.theme).toBe("GitHub");
      const servers = settings.mcpServers as Record<string, Record<string, unknown>>;
      expect(servers.user).toEqual({ command: "mine" });
      expect(servers.srv).toMatchObject({
        command: "npx",
        includeTools: ["read", "list"],
        excludeTools: ["delete"],
      });
      expect(servers.remote).toEqual({
        httpUrl: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
      });
    });
  });

  it("uses url for SSE servers and scans servers back", async () => {
    await withProject(async (dir) => {
      const serializer = new GeminiCliSerializer();
      const files = await serializer.serialize(
        [mcp("sse", { transport: "http", url: "https://e.com/sse", http_transport: "sse" })],
        dir,
      );
      const file = files.find((f) => f.path === ".gemini/settings.json");
      expect((jsonAt(files, ".gemini/settings.json").mcpServers as Record<string, unknown>).sse).toEqual({
        url: "https://e.com/sse",
      });
      writeTextFile(join(dir, ".gemini/settings.json"), file?.content ?? "");
      const scanned = await serializer.scan(dir);
      expect(scanned.some((r) => r.type === "mcp_server" && r.name === "sse")).toBe(true);
    });
  });

  it("leaves an unparseable settings file untouched", async () => {
    await withProject(async (dir) => {
      writeTextFile(join(dir, ".gemini/settings.json"), "{ not json");
      const files = await new GeminiCliSerializer().serialize([mcp("srv", stdio)], dir);
      expect(files.find((f) => f.path === ".gemini/settings.json")?.content).toBe("{ not json");
    });
  });
});

describe("Zed MCP in .zed/settings.json", () => {
  it("writes context_servers and keeps user settings", async () => {
    await withProject(async (dir) => {
      writeTextFile(
        join(dir, ".zed/settings.json"),
        '{\n  "tab_size": 2,\n  "context_servers": { "user": { "command": "mine" } },\n}\n',
      );
      const files = await new GenericAgentsSerializer("zed").serialize(
        [mcp("srv", stdio), mcp("remote", http)],
        dir,
      );
      const settings = jsonAt(files, ".zed/settings.json");
      expect(settings.tab_size).toBe(2);
      const servers = settings.context_servers as Record<string, unknown>;
      expect(servers.user).toEqual({ command: "mine" });
      expect(servers.srv).toEqual({ command: "npx", args: ["-y", "srv"], env: { TOKEN: "${TOKEN}" } });
      expect(servers.remote).toEqual({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
      });
      expect(settings.mcpServers).toBeUndefined();
    });
  });

  it("scans context_servers back", async () => {
    await withProject(async (dir) => {
      writeTextFile(
        join(dir, ".zed/settings.json"),
        '// c\n{ "context_servers": { "srv": { "command": "npx" } } }\n',
      );
      const scanned = await new GenericAgentsSerializer("zed").scan(dir);
      expect(scanned.some((r) => r.type === "mcp_server" && r.name === "srv")).toBe(true);
    });
  });
});

describe("Droid MCP in .factory/mcp.json", () => {
  it("writes typed entries with disabledTools and keeps user servers", async () => {
    await withProject(async (dir) => {
      writeTextFile(
        join(dir, ".factory/mcp.json"),
        `${JSON.stringify({ mcpServers: { user: { type: "stdio", command: "mine" } } }, null, 2)}\n`,
      );
      const files = await new GenericAgentsSerializer("droid").serialize(
        [mcp("srv", stdio), mcp("remote", http)],
        dir,
      );
      const servers = jsonAt(files, ".factory/mcp.json").mcpServers as Record<string, unknown>;
      expect(servers.user).toEqual({ type: "stdio", command: "mine" });
      expect(servers.srv).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "srv"],
        env: { TOKEN: "${TOKEN}" },
        disabledTools: ["delete"],
      });
      expect(servers.remote).toMatchObject({ type: "http", url: "https://example.com/mcp" });
    });
  });
});

describe("Kiro MCP, skills, and hooks", () => {
  it("merges servers into .kiro/settings/mcp.json and keeps user keys", async () => {
    await withProject(async (dir) => {
      writeTextFile(
        join(dir, ".kiro/settings/mcp.json"),
        `${JSON.stringify({ mcpServers: { user: { command: "mine", autoApprove: ["x"] } } }, null, 2)}\n`,
      );
      const files = await new GenericAgentsSerializer("kiro").serialize([mcp("srv", stdio)], dir);
      const servers = jsonAt(files, ".kiro/settings/mcp.json").mcpServers as Record<string, unknown>;
      expect(servers.user).toEqual({ command: "mine", autoApprove: ["x"] });
      expect(servers.srv).toMatchObject({ command: "npx", disabledTools: ["delete"] });
    });
  });

  it("writes one owned hook file per mappable hook and skips the rest", async () => {
    await withProject(async (dir) => {
      const hook = (name: string, metadata: Record<string, unknown>) =>
        makeResource({ type: "hook", name, content: "", metadata });
      const files = await new GenericAgentsSerializer("kiro").serialize(
        [
          hook("on-stop", { event: "Stop", script: "echo done", timeout: 30 }),
          hook("all-tools", { event: "PreToolUse", script: "./check.sh", matcher: "*" }),
          hook("bash-only", { event: "PreToolUse", script: "./bash.sh", matcher: "Bash" }),
          hook("prompt", { event: "UserPromptSubmit", script: "./p.sh" }),
        ],
        dir,
      );
      const hookFiles = files.filter((f) => f.path.startsWith(".kiro/hooks/")).map((f) => f.path);
      expect(hookFiles.sort()).toEqual([".kiro/hooks/all-tools.json", ".kiro/hooks/on-stop.json"]);
      expect(jsonAt(files, ".kiro/hooks/on-stop.json")).toEqual({
        version: "v1",
        hooks: [
          { name: "on-stop", trigger: "Stop", action: { type: "command", command: "echo done" }, timeout: 30 },
        ],
      });
      expect(jsonAt(files, ".kiro/hooks/all-tools.json").hooks).toEqual([
        { name: "all-tools", trigger: "PreToolUse", matcher: "*", action: { type: "command", command: "./check.sh" } },
      ]);

      const onStop = files.find((f) => f.path === ".kiro/hooks/on-stop.json");
      writeTextFile(join(dir, ".kiro/hooks/on-stop.json"), onStop?.content ?? "");
      const scanned = await new GenericAgentsSerializer("kiro").scan(dir);
      const scannedHook = scanned.find((r) => r.type === "hook");
      expect(scannedHook?.name).toBe("on-stop");
      expect(scannedHook?.metadata).toMatchObject({ event: "Stop", script: "echo done", timeout: 30 });
    });
  });

  it("scans skills from .kiro/skills and still from the earlier .agents/skills", async () => {
    await withProject(async (dir) => {
      writeTextFile(join(dir, ".kiro/skills/new/SKILL.md"), "---\nname: new\ndescription: n\n---\n# New\n");
      writeTextFile(join(dir, ".agents/skills/old/SKILL.md"), "---\nname: old\ndescription: o\n---\n# Old\n");
      const names = (await new GenericAgentsSerializer("kiro").scan(dir))
        .filter((r) => r.type === "skill")
        .map((r) => r.name)
        .sort();
      expect(names).toEqual(["new", "old"]);
    });
  });
});

describe("GitHub Copilot path-scoped instructions", () => {
  it("writes rules as .instructions.md with applyTo globs", async () => {
    const files = await new CopilotSerializer("github-copilot").serialize(
      [
        makeResource({
          type: "rule",
          name: "typescript",
          description: "TS rules",
          content: "Use strict types.",
          metadata: { globs: ["**/*.ts", "**/*.tsx"], always_apply: false },
        }),
        makeResource({
          type: "rule",
          name: "everywhere",
          content: "Be kind.",
          metadata: { globs: [], always_apply: true },
        }),
      ],
      ".",
    );
    const ts = files.find((f) => f.path === ".github/instructions/typescript.instructions.md");
    expect(ts?.content).toContain("applyTo: '**/*.ts,**/*.tsx'");
    expect(ts?.content).toContain("Use strict types.");
    const all = files.find((f) => f.path === ".github/instructions/everywhere.instructions.md");
    expect(all?.content).toContain("applyTo: '**'");
  });

  it("scans .instructions.md files back into rules", async () => {
    await withProject(async (dir) => {
      writeTextFile(
        join(dir, ".github/instructions/py.instructions.md"),
        '---\napplyTo: "**/*.py, tests/**"\n---\nUse pytest.\n',
      );
      writeTextFile(join(dir, ".github/instructions/notes.md"), "not an instructions file\n");
      const rules = (await new CopilotSerializer("github-copilot").scan(dir)).filter(
        (r) => r.type === "rule",
      );
      expect(rules).toHaveLength(1);
      expect(rules[0]?.name).toBe("py");
      expect(rules[0]?.metadata).toEqual({ globs: ["**/*.py", "tests/**"], always_apply: false });
    });
  });

  it("carries enabled_tools as the Copilot tools allow list", async () => {
    const files = await new CopilotSerializer("copilot-cli").serialize([mcp("srv", stdio)], ".");
    const mcpFile = files.find((f) => f.path.endsWith(".json") && f.content.includes("mcpServers"));
    const servers = (JSON.parse(mcpFile?.content ?? "{}") as { mcpServers: Record<string, { tools: string[] }> })
      .mcpServers;
    expect(servers.srv?.tools).toEqual(["read", "list"]);
  });
});
