import { join } from "node:path";
import { describe, expect, it, spyOn } from "bun:test";
import { parse } from "yaml";
import {
  HARNESSTAP_PATCH_PREFIX,
  MCP_CLIENT_PLUGIN_NAME,
  mergeCordisPatch,
  parseCordisMcpServers,
  mergeSettingsYaml,
  parseSettingsResources,
  resolveDshHome,
  sanitizePresetId,
  mcpResourceToInsertItem,
  hooksBridgeInsertItem,
} from "../../src/platforms/deepseek-harness-home.ts";

function requireInsert(row: ReturnType<typeof mcpResourceToInsertItem>) {
  if (row === null) throw new Error("expected mcp insert row");
  return row;
}

describe("resolveDshHome", () => {
  it("uses DSH_HOME when set, otherwise {home}/.dsh", () => {
    const previous = process.env.DSH_HOME;
    try {
      delete process.env.DSH_HOME;
      expect(resolveDshHome("/Users/demo")).toBe(join("/Users/demo", ".dsh"));
      process.env.DSH_HOME = "/custom/dsh";
      expect(resolveDshHome("/Users/demo")).toBe("/custom/dsh");
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    }
  });
});

describe("mergeCordisPatch", () => {
  it("creates a list when the file is missing", () => {
    const row = mcpResourceToInsertItem("docs", {
      transport: "stdio",
      command: "docs-mcp",
      args: ["--root", "."],
      env: { API_KEY: "${DOCS_KEY}" },
    });
    expect(row).not.toBeNull();
    const yaml = mergeCordisPatch(undefined, [requireInsert(row)]);
    const parsed = parse(yaml) as unknown[];
    expect(parsed).toEqual([
      {
        insert: [
          expect.objectContaining({
            id: `${HARNESSTAP_PATCH_PREFIX}mcp-docs`,
            name: MCP_CLIENT_PLUGIN_NAME,
            config: expect.objectContaining({
              serverName: "docs",
              transport: "stdio",
              command: "docs-mcp",
              args: ["--root", "."],
              env: { API_KEY: "${DOCS_KEY}" },
            }),
          }),
        ],
      },
    ]);
  });

  it("keeps user insert rows and replaces harnesstap-* rows", () => {
    const existing = `
- insert:
    - id: user-memory
      name: "${MCP_CLIENT_PLUGIN_NAME}"
      config:
        serverName: memory
        transport: stdio
        command: memory-mcp
    - id: harnesstap-mcp-old
      name: "${MCP_CLIENT_PLUGIN_NAME}"
      config:
        serverName: old
        transport: stdio
        command: old-mcp
`;
    const next = mcpResourceToInsertItem("docs", {
      transport: "stdio",
      command: "docs-mcp",
    });
    const parsed = parse(mergeCordisPatch(existing, [requireInsert(next)])) as Array<{
      insert: Array<{ id: string }>;
    }>;
    const ids = parsed.flatMap((op) => op.insert?.map((item) => item.id) ?? []);
    expect(ids).toContain("user-memory");
    expect(ids).toContain("harnesstap-mcp-docs");
    expect(ids).not.toContain("harnesstap-mcp-old");
  });

  it("throws when the document is not a YAML list", () => {
    expect(() => mergeCordisPatch("mcp: true\n", [])).toThrow(/list of patch operations/);
  });

  it("is idempotent", () => {
    const row = requireInsert(
      mcpResourceToInsertItem("docs", { transport: "stdio", command: "docs-mcp" }),
    );
    const first = mergeCordisPatch(undefined, [row]);
    const second = mergeCordisPatch(first, [row]);
    expect(parse(second)).toEqual(parse(first));
  });
});

describe("parseCordisMcpServers", () => {
  it("skips malformed patch YAML without warning", () => {
    const malformed = `- insert:
    grok-4.6 prism
    - id: memory
`;
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseCordisMcpServers(malformed, "~/.dsh/cordis.patch.yml")).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("reports the YAML parse error when merging a malformed patch", () => {
    const malformed = `- insert:
    grok-4.6 prism
    - id: memory
`;
    expect(() => mergeCordisPatch(malformed, [])).toThrow(
      /Malformed cordis\.patch\.yml: Implicit keys need to be on a single line/,
    );
  });

  it("reads stdio and streamable-http rows", () => {
    const yaml = `
- insert:
    - id: user-memory
      name: "${MCP_CLIENT_PLUGIN_NAME}"
      config:
        serverName: memory
        transport: stdio
        command: memory-mcp
        args: ["--root", "."]
    - id: harnesstap-mcp-linear
      name: "${MCP_CLIENT_PLUGIN_NAME}"
      config:
        serverName: linear
        transport: streamable-http
        url: https://mcp.linear.app/mcp
        headers:
          Authorization: Bearer \${LINEAR_API_KEY}
`;
    expect(parseCordisMcpServers(yaml, "~/.dsh/cordis.patch.yml")).toEqual([
      expect.objectContaining({
        name: "memory",
        metadata: expect.objectContaining({
          transport: "stdio",
          command: "memory-mcp",
        }),
      }),
      expect.objectContaining({
        name: "linear",
        metadata: expect.objectContaining({
          transport: "http",
          url: "https://mcp.linear.app/mcp",
        }),
      }),
    ]);
  });
});

describe("settings yaml", () => {
  it("merges only agent-default-model and permission namespaces", () => {
    const yaml = mergeSettingsYaml("llm-pi-ai:\n  keep: true\n", {
      model: { provider: "deepseek", model: "deepseek-chat" },
      permissionPreset: "workspace-write",
    });
    const parsed = parse(yaml) as Record<string, unknown>;
    expect(parsed["llm-pi-ai"]).toEqual({ keep: true });
    expect(parsed["agent-default-model"]).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
    expect(parsed.permission).toEqual({ defaultPreset: "workspace-write" });
  });

  it("throws on invalid settings YAML", () => {
    expect(() => mergeSettingsYaml("- just a list\n", { model: { model: "x" } })).toThrow(
      /settings\.yaml/,
    );
  });

  it("quotes model names that contain spaces", () => {
    const yaml = mergeSettingsYaml(undefined, {
      model: { provider: "xai", model: "grok-4.6 prism" },
    });
    expect(yaml).toContain('model: "grok-4.6 prism"');
    const parsed = parse(yaml) as Record<string, unknown>;
    expect(parsed["agent-default-model"]).toEqual({
      provider: "xai",
      model: "grok-4.6 prism",
    });
  });

  it("skips malformed settings YAML without warning", () => {
    const malformed = `agent-default-model:
  grok-4.6 prism
  provider: deepseek
`;
    expect(() => parse(malformed)).toThrow(/Implicit keys need to be on a single line/);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(parseSettingsResources(malformed, "~/.dsh/settings.yaml")).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("reports the YAML parse error when merging malformed settings", () => {
    const malformed = `agent-default-model:
  grok-4.6 prism
  provider: deepseek
`;
    expect(() => mergeSettingsYaml(malformed, { model: { model: "deepseek-chat" } })).toThrow(
      /Malformed settings\.yaml: Implicit keys need to be on a single line/,
    );
  });

  it("parses model and permission preset", () => {
    const resources = parseSettingsResources(
      `
agent-default-model:
  provider: deepseek
  model: deepseek-chat
permission:
  defaultPreset: danger-full-access
`,
      "~/.dsh/settings.yaml",
    );
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "model_config",
          name: "default",
          metadata: { model: "deepseek-chat", provider: "deepseek" },
        }),
        expect.objectContaining({
          type: "permission",
          name: "default",
          metadata: { action: "allow", pattern: "danger-full-access" },
        }),
      ]),
    );
  });
});

describe("sanitizePresetId", () => {
  it("emits dsh-legal kebab ids", () => {
    expect(sanitizePresetId("Explorer Agent")).toBe("explorer-agent");
    expect(sanitizePresetId("@@@")).toBe("agent");
  });
});

describe("hooksBridgeInsertItem", () => {
  it("points dsh-hooks-claude-code at an absolute configPath", () => {
    expect(hooksBridgeInsertItem("/Users/demo/.dsh/hooks/harnesstap.json")).toEqual({
      id: `${HARNESSTAP_PATCH_PREFIX}hooks-claude-code`,
      name: "@deepseek-ai/dsh-hooks-claude-code",
      config: { configPath: "/Users/demo/.dsh/hooks/harnesstap.json" },
    });
  });
});
