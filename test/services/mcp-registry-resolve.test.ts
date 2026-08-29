import { describe, expect, it } from "bun:test";
import { mcpMetadataFromRegistryServer } from "../../src/services/mcp-registry-resolve.ts";
import { parseMcpRegistryServer, splitMcpRegistryIdentity } from "../../src/services/mcp-registry.ts";
import { appendMcpRegistryIdToManifest } from "../../src/services/apm-mcp-manifest.ts";

const githubLatest = {
  server: {
    name: "io.github.github/github-mcp-server",
    description: "Connect AI assistants to GitHub",
    title: "GitHub",
    version: "1.11.0",
    packages: [
      {
        registryType: "oci",
        identifier: "ghcr.io/github/github-mcp-server:1.11.0",
        transport: { type: "stdio" },
        runtimeArguments: [
          { type: "named", name: "-p", value: "127.0.0.1:8085:8085" },
          { type: "named", name: "-e", value: "GITHUB_PERSONAL_ACCESS_TOKEN={token}" },
        ],
      },
    ],
    remotes: [
      {
        type: "streamable-http",
        url: "https://api.githubcopilot.com/mcp/",
        headers: [{ name: "Authorization", isSecret: true }],
      },
    ],
  },
};

const npmStdio = {
  name: "io.github.example/filesystem",
  version: "1.0.2",
  packages: [
    {
      registryType: "npm",
      identifier: "@modelcontextprotocol/server-filesystem",
      version: "1.0.2",
      runtimeHint: "npx",
      transport: { type: "stdio" },
      runtimeArguments: [{ type: "positional", value: "-y" }],
      environmentVariables: [
        { name: "LOG_LEVEL", default: "info" },
        { name: "API_KEY", isRequired: true, isSecret: true },
      ],
    },
  ],
};

describe("MCP registry identity", () => {
  it("splits optional @version after the server name", () => {
    expect(splitMcpRegistryIdentity("io.github.github/github-mcp-server")).toEqual({
      name: "io.github.github/github-mcp-server",
      version: "latest",
    });
    expect(splitMcpRegistryIdentity("io.github.github/github-mcp-server@1.11.0")).toEqual({
      name: "io.github.github/github-mcp-server",
      version: "1.11.0",
    });
  });

  it("prefers remotes over packages", () => {
    const server = parseMcpRegistryServer(githubLatest);
    expect(server).not.toBeNull();
    if (!server) {
      throw new Error("expected parsed server");
    }
    const metadata = mcpMetadataFromRegistryServer(server);
    expect(metadata.transport).toBe("http");
    expect(metadata.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(metadata.headers?.Authorization).toBe("Bearer ${AUTHORIZATION}");
    expect(metadata.command).toBeUndefined();
  });

  it("emits npx stdio from an npm package when remotes are absent", () => {
    const server = parseMcpRegistryServer(npmStdio);
    expect(server).not.toBeNull();
    if (!server) {
      throw new Error("expected parsed server");
    }
    const metadata = mcpMetadataFromRegistryServer(server);
    expect(metadata.transport).toBe("stdio");
    expect(metadata.command).toBe("npx");
    expect(metadata.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-filesystem@1.0.2",
    ]);
    expect(metadata.env).toEqual({
      LOG_LEVEL: "info",
      API_KEY: "${API_KEY}",
    });
  });

  it("emits docker run for oci packages", () => {
    const server = parseMcpRegistryServer({
      name: "io.example/oci",
      packages: [
        {
          registryType: "oci",
          identifier: "ghcr.io/example/tool:1.0.0",
          transport: { type: "stdio" },
        },
      ],
    });
    expect(server).not.toBeNull();
    if (!server) {
      throw new Error("expected parsed server");
    }
    const metadata = mcpMetadataFromRegistryServer(server);
    expect(metadata.command).toBe("docker");
    expect(metadata.args).toEqual(["run", "-i", "--rm", "ghcr.io/example/tool:1.0.0"]);
  });
});

describe("append MCP registry id to apm.yml", () => {
  it("creates dependencies.mcp and is idempotent", () => {
    const first = appendMcpRegistryIdToManifest(
      `name: demo\nversion: "1.0.0"\n`,
      "io.github.github/github-mcp-server",
    );
    expect(first.added).toBe(true);
    expect(first.next).toContain("io.github.github/github-mcp-server");
    const second = appendMcpRegistryIdToManifest(
      first.next,
      "io.github.github/github-mcp-server",
    );
    expect(second.added).toBe(false);
  });

  it("keeps existing apm dependencies", () => {
    const result = appendMcpRegistryIdToManifest(
      `name: demo
version: "1.0.0"
dependencies:
  apm:
    - team-stack
`,
      "io.github.example/fs",
    );
    expect(result.next).toContain("team-stack");
    expect(result.next).toContain("io.github.example/fs");
  });
});
