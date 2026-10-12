import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { createInitializedTestContext } from "../../helpers/db.ts";
import type { TestContext } from "../../helpers/db.ts";
import { writeTextFile } from "../../helpers/fs.ts";
import { specErrors } from "../../helpers/agent-plugins-spec.ts";
import { addResourceToPlugin, createPlugin, getPluginResources } from "../../../src/models/plugin-model.ts";
import { createResource } from "../../../src/models/resource.ts";
import { buildApPackageFiles, readApPackageFiles } from "../../../src/services/agent-plugins/files.ts";
import { importApPackageFiles, parseApPackageFiles } from "../../../src/services/agent-plugins/import.ts";
import {
  buildSpecMcpJson,
  HT_MCP_EXTRAS_PATH,
  readApMcpServers,
} from "../../../src/services/agent-plugins/spec-mcp.ts";
import { packProject } from "../../../src/services/apm-pack.ts";
import type { McpServerMetadata } from "../../../src/types.ts";

const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createInitializedTestContext("ap-spec-mcp-");
});

afterEach(async () => {
  await ctx.cleanup();
});

function seed(name: string, servers: Record<string, McpServerMetadata>): string {
  const plugin = createPlugin({ name, version: "1.0.0" });
  for (const [serverName, metadata] of Object.entries(servers)) {
    addResourceToPlugin(
      plugin.id,
      createResource({
        type: "mcp_server",
        name: serverName,
        description: "",
        content: "",
        metadata,
        source: "test",
      }).id,
    );
  }
  return plugin.id;
}

const SERVERS: Record<string, McpServerMetadata> = {
  local: { transport: "stdio", command: "npx", args: ["-y", "local"], env: { MODE: "fast" } },
  remote: {
    transport: "http",
    url: "https://mcp.example.com/mcp",
    headers: { "X-Client": "harnesstap" },
    connection_type: "http",
  },
  legacy: { transport: "http", url: "https://mcp.example.com/sse", connection_type: "sse" },
  remoteWithEnv: { transport: "http", url: "https://mcp.example.com/env", env: { REGION: "eu" } },
  reserved: { transport: "stdio", command: "./bin/server", env: { PLUGIN_ROOT: "/x", KEEP: "1" } },
  unlaunchable: { transport: "stdio", args: ["--flag"] },
};

describe("buildSpecMcpJson", () => {
  it("writes $schema and an explicit spec type for every server", () => {
    const { document, extras } = buildSpecMcpJson(SERVERS);
    expect(document.$schema).toBe(MCP_SCHEMA);
    expect(document.mcpServers).toEqual({
      legacy: { type: "sse", url: "https://mcp.example.com/sse" },
      local: { type: "stdio", command: "npx", args: ["-y", "local"], env: { MODE: "fast" } },
      remote: {
        type: "streamable-http",
        url: "https://mcp.example.com/mcp",
        headers: { "X-Client": "harnesstap" },
      },
      remoteWithEnv: { type: "streamable-http", url: "https://mcp.example.com/env" },
      reserved: { type: "stdio", command: "./bin/server", env: { KEEP: "1" } },
    });
    expect(specErrors("mcp", document)).toEqual([]);
    // Nothing is dropped: what the spec shape cannot carry stays in the extension.
    expect(extras).toEqual({
      remote: { connection_type: "http" },
      remoteWithEnv: { env: { REGION: "eu" } },
      reserved: { env: { PLUGIN_ROOT: "/x" } },
      unlaunchable: { transport: "stdio", args: ["--flag"] },
    });
  });

  it("reads its own output back to the same metadata", () => {
    const { document, extras } = buildSpecMcpJson(SERVERS);
    const read = readApMcpServers(JSON.parse(JSON.stringify(document)), { servers: extras });
    expect(read).toEqual(SERVERS);
  });

  it("does not treat a spec `type` as a harness connection type", () => {
    const read = readApMcpServers(
      {
        $schema: MCP_SCHEMA,
        mcpServers: {
          a: { type: "stdio", command: "npx" },
          b: { type: "streamable-http", url: "https://x.example/mcp" },
          c: { type: "sse", url: "https://x.example/sse" },
        },
      },
      undefined,
    );
    expect(read).toEqual({
      a: { transport: "stdio", command: "npx" },
      b: { transport: "http", url: "https://x.example/mcp" },
      c: { transport: "http", url: "https://x.example/sse", connection_type: "sse" },
    });
  });

  it("keeps the legacy (pre-spec) mcp.json parse unchanged", () => {
    const read = readApMcpServers(
      { mcpServers: { api: { type: "http", url: "https://x.example/mcp" }, s: { command: "npx" } } },
      undefined,
    );
    expect(read).toEqual({
      api: { transport: "http", url: "https://x.example/mcp", connection_type: "http" },
      s: { transport: "stdio", command: "npx" },
    });
  });
});

describe("plugin export mcp.json", () => {
  it("is spec-valid and round-trips export -> import -> export byte for byte", async () => {
    const files = buildApPackageFiles(seed("mcp-roundtrip", SERVERS));
    const mcp = JSON.parse(files["mcp.json"]!.content) as unknown;
    expect(specErrors("mcp", mcp)).toEqual([]);
    expect(files[HT_MCP_EXTRAS_PATH]).toBeDefined();
    const extras = parseToml(files[HT_MCP_EXTRAS_PATH]!.content) as { schema: string };
    expect(extras.schema).toBe("urn:harnesstap:ap-extension:v1");

    const parsed = parseApPackageFiles(files);
    const byName = Object.fromEntries(
      parsed.resources
        .filter((resource) => resource.type === "mcp_server")
        .map((resource) => [resource.name, resource.metadata]),
    );
    expect(byName).toEqual(SERVERS);

    // Fresh library, then import the exported package and export it again.
    await ctx.cleanup();
    ctx = await createInitializedTestContext("ap-spec-mcp-reimport-");
    const reimported = importApPackageFiles(files);
    const again = buildApPackageFiles(reimported.id);
    expect(again["mcp.json"]).toEqual(files["mcp.json"]);
    expect(again[HT_MCP_EXTRAS_PATH]).toEqual(files[HT_MCP_EXTRAS_PATH]);
    expect(getPluginResources(reimported.id).filter((r) => r.type === "mcp_server")).toHaveLength(
      Object.keys(SERVERS).length,
    );
  });
});

describe("ht pack mcp.json", () => {
  function writeProject(): void {
    writeTextFile(join(ctx.projectDir, "apm.yml"), 'name: pack-mcp\nversion: "1.0.0"\n');
  }

  it("converts a harness-style .mcp.json in the packed copy only", () => {
    writeProject();
    const source = `${JSON.stringify(
      {
        mcpServers: {
          search: { command: "npx", args: ["-y", "search"], envFile: ".env" },
          api: { type: "http", url: "https://api.example.com/mcp", headers: { A: "b" } },
        },
      },
      null,
      2,
    )}\n`;
    writeTextFile(join(ctx.projectDir, ".mcp.json"), source);
    const result = packProject({ projectRoot: ctx.projectDir });
    const files = readApPackageFiles(result.outputPath);
    const mcp = JSON.parse(files["mcp.json"]!.content) as unknown;
    expect(specErrors("mcp", mcp)).toEqual([]);
    expect(mcp).toEqual({
      $schema: MCP_SCHEMA,
      mcpServers: {
        api: { type: "streamable-http", url: "https://api.example.com/mcp", headers: { A: "b" } },
        search: { type: "stdio", command: "npx", args: ["-y", "search"] },
      },
    });
    const extras = parseToml(files[HT_MCP_EXTRAS_PATH]!.content) as {
      servers: Record<string, Record<string, unknown>>;
    };
    expect(extras.servers).toEqual({
      api: { connection_type: "http" },
      search: { env_file: ".env" },
    });
    // The project file is untouched.
    expect(readFileSync(join(ctx.projectDir, ".mcp.json"), "utf8")).toBe(source);
  });

  it("packs a source mcp.json that already uses the spec $schema as is", () => {
    writeProject();
    const source = `${JSON.stringify(
      {
        $schema: MCP_SCHEMA,
        mcpServers: { s: { type: "stdio", command: "./run", cwd: "${PLUGIN_ROOT}" } },
      },
      null,
      2,
    )}\n`;
    writeTextFile(join(ctx.projectDir, "mcp.json"), source);
    const result = packProject({ projectRoot: ctx.projectDir });
    expect(readFileSync(join(result.outputPath, "mcp.json"), "utf8")).toBe(source);
  });
});
