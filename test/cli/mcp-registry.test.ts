import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli } from "../helpers/cli.ts";
import { createInitializedTestContext } from "../helpers/db.ts";
import type { TestContext } from "../helpers/db.ts";
import { writeTextFile } from "../helpers/fs.ts";

let ctx: TestContext;
let originalFetch: typeof globalThis.fetch;

const GITHUB_ID = "io.github.github/github-mcp-server";

function githubPayload() {
  return {
    server: {
      name: GITHUB_ID,
      description: "Connect AI assistants to GitHub",
      version: "1.11.0",
      remotes: [
        {
          type: "streamable-http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: [{ name: "Authorization", isSecret: true }],
        },
      ],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  ctx = await createInitializedTestContext("mcp-registry-cli-");
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await ctx.cleanup();
});

describe("ht install MCP registry identities", () => {
  it("resolves a registry string into native Cursor MCP config", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/v0.1/servers/");
      expect(url).toContain(encodeURIComponent(GITHUB_ID));
      return jsonResponse(githubPayload());
    }) as unknown as typeof fetch;

    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
dependencies:
  mcp:
    - ${GITHUB_ID}
`,
    );

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    const mcp = JSON.parse(
      readFileSync(join(ctx.projectDir, ".cursor", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, { url?: string; headers?: Record<string, string> }> };
    expect(mcp.mcpServers["github-mcp-server"]?.url).toBe(
      "https://api.githubcopilot.com/mcp/",
    );
    expect(mcp.mcpServers["github-mcp-server"]?.headers?.Authorization).toBe(
      "Bearer ${AUTHORIZATION}",
    );
  });

  it("keeps self-defined registry: false on the inline path", async () => {
    const fetchMock = mock(async () => {
      throw new Error("registry must not be contacted for self-defined MCP");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
dependencies:
  mcp:
    - name: filesystem
      registry: false
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
`,
    );

    const result = await runCli([
      "install",
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(fetchMock.mock.calls.length).toBe(0);
    const mcp = JSON.parse(
      readFileSync(join(ctx.projectDir, ".cursor", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, { command?: string }> };
    expect(mcp.mcpServers.filesystem?.command).toBe("npx");
  });

  it("appends --mcp then rolls back when registry lookup fails", async () => {
    globalThis.fetch = mock(async () => jsonResponse({ error: "missing" }, 404)) as unknown as typeof fetch;

    const original = `name: demo
version: "1.0.0"
targets: [cursor]
`;
    writeTextFile(join(ctx.projectDir, "apm.yml"), original);

    const result = await runCli([
      "install",
      "--mcp",
      GITHUB_ID,
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode).toBe(1);
    expect(readFileSync(join(ctx.projectDir, "apm.yml"), "utf8")).toBe(original);
    expect(existsSync(join(ctx.projectDir, ".cursor", "mcp.json"))).toBe(false);
  });

  it("ht mcp install appends the identity then installs", async () => {
    globalThis.fetch = mock(async () => jsonResponse(githubPayload())) as unknown as typeof fetch;

    writeTextFile(
      join(ctx.projectDir, "apm.yml"),
      `name: demo
version: "1.0.0"
targets: [cursor]
`,
    );

    const result = await runCli([
      "mcp",
      "install",
      GITHUB_ID,
      "--project",
      ctx.projectDir,
      "--no-interactive",
    ]);
    expect(result.exitCode ?? 0, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(ctx.projectDir, "apm.yml"), "utf8")).toContain(GITHUB_ID);
    expect(existsSync(join(ctx.projectDir, ".cursor", "mcp.json"))).toBe(true);
  });
});

describe("ht mcp discovery", () => {
  it("lists and searches registry servers", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("search=")) {
        return jsonResponse({
          servers: [githubPayload()],
          metadata: { count: 1 },
        });
      }
      return jsonResponse({
        servers: [githubPayload()],
        metadata: { nextCursor: "next", count: 1 },
      });
    }) as unknown as typeof fetch;

    const listed = await runCli(["mcp", "list", "--format", "json"]);
    expect(listed.exitCode ?? 0, listed.stderr || listed.stdout).toBe(0);
    const listPayload = JSON.parse(listed.stdout) as {
      servers: Array<{ server: { name: string } }>;
    };
    expect(listPayload.servers[0]?.server.name).toBe(GITHUB_ID);

    const searched = await runCli(["mcp", "search", "github", "--format", "json"]);
    expect(searched.exitCode ?? 0).toBe(0);
    const searchPayload = JSON.parse(searched.stdout) as {
      servers: Array<{ server: { name: string } }>;
    };
    expect(searchPayload.servers[0]?.server.name).toBe(GITHUB_ID);
  });

  it("shows the emitted native metadata", async () => {
    globalThis.fetch = mock(async () => jsonResponse(githubPayload())) as unknown as typeof fetch;
    const shown = await runCli(["mcp", "show", GITHUB_ID, "--format", "json"]);
    expect(shown.exitCode ?? 0, shown.stderr || shown.stdout).toBe(0);
    const payload = JSON.parse(shown.stdout) as {
      metadata: { url?: string; transport: string };
    };
    expect(payload.metadata.transport).toBe("http");
    expect(payload.metadata.url).toBe("https://api.githubcopilot.com/mcp/");
  });
});
