import { describe, expect, it } from "bun:test";
import {
  emitCursorMcpServerEntry,
  inferMcpTransport,
  mcpConfigContentsEquivalent,
  parseMcpServerEntry,
  parseMcpServersDocument,
} from "../../src/services/mcp-config-bridge.ts";

describe("mcp config bridge", () => {
  describe("inferMcpTransport", () => {
    it("returns http for url-based entries", () => {
      expect(inferMcpTransport({ url: "https://example.com/mcp" })).toBe("http");
    });

    it("returns http for remote, sse, and streamable_http types", () => {
      expect(inferMcpTransport({ type: "remote" })).toBe("http");
      expect(inferMcpTransport({ type: "sse" })).toBe("http");
      expect(inferMcpTransport({ type: "streamable_http" })).toBe("http");
    });

    it("returns stdio for command-based entries", () => {
      expect(inferMcpTransport({ command: "npx", args: ["-y", "server"] })).toBe("stdio");
    });

    it("returns stdio when type is stdio", () => {
      expect(inferMcpTransport({ type: "stdio", command: "node" })).toBe("stdio");
    });
  });

  describe("parseMcpServerEntry", () => {
    it("parses stdio entries with command, args, and env", () => {
      const metadata = parseMcpServerEntry({
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack"],
        env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
        envFile: ".env.mcp",
      });

      expect(metadata).toEqual({
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-slack"],
        env: { SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}" },
        connection_type: "stdio",
        env_file: ".env.mcp",
      });
    });

    it("parses http entries with url, headers, and auth", () => {
      const metadata = parseMcpServerEntry({
        type: "http",
        url: "https://mcp.example.com",
        headers: {
          Authorization: "Bearer ${API_TOKEN}",
        },
        auth: {
          CLIENT_ID: "${CLIENT_ID}",
          CLIENT_SECRET: "${CLIENT_SECRET}",
          scopes: ["read", "write"],
        },
      });

      expect(metadata).toEqual({
        transport: "http",
        url: "https://mcp.example.com",
        headers: { Authorization: "Bearer ${API_TOKEN}" },
        connection_type: "http",
        auth: {
          CLIENT_ID: "${CLIENT_ID}",
          CLIENT_SECRET: "${CLIENT_SECRET}",
          scopes: ["read", "write"],
        },
      });
    });

    it("parses array command shapes used by OpenCode", () => {
      const metadata = parseMcpServerEntry({
        type: "remote",
        command: ["node", "server.js", "--port", "8080"],
        url: "https://ignored-when-type-remote.example.com",
      });

      expect(metadata).toEqual({
        transport: "http",
        command: "node",
        args: ["server.js", "--port", "8080"],
        url: "https://ignored-when-type-remote.example.com",
        connection_type: "remote",
      });
    });

    it("returns null for non-object entries", () => {
      expect(parseMcpServerEntry(null)).toBeNull();
      expect(parseMcpServerEntry("stdio")).toBeNull();
    });
  });

  describe("parseMcpServersDocument", () => {
    it("parses mcpServers and mcp_servers keys", () => {
      const fromMcpServers = parseMcpServersDocument({
        mcpServers: {
          local: { command: "node", args: ["server.js"] },
        },
      });
      const fromMcpServersSnake = parseMcpServersDocument({
        mcp_servers: {
          remote: { url: "https://example.com/mcp" },
        },
      });

      expect(fromMcpServers.local).toEqual({
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });
      expect(fromMcpServersSnake.remote).toEqual({
        transport: "http",
        url: "https://example.com/mcp",
      });
    });

    it("returns an empty object for invalid documents", () => {
      expect(parseMcpServersDocument(null)).toEqual({});
      expect(parseMcpServersDocument({})).toEqual({});
      expect(parseMcpServersDocument({ mcpServers: "invalid" })).toEqual({});
    });
  });

  describe("emitCursorMcpServerEntry", () => {
    it("emits stdio entries with type, command, args, env, and envFile", () => {
      expect(
        emitCursorMcpServerEntry({
          transport: "stdio",
          command: "npx",
          args: ["-y", "server"],
          env: { API_KEY: "${API_KEY}" },
          env_file: ".env.mcp",
        }),
      ).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "server"],
        env: { API_KEY: "${API_KEY}" },
        envFile: ".env.mcp",
      });
    });

    it("emits http entries with url, headers, and auth without type", () => {
      expect(
        emitCursorMcpServerEntry({
          transport: "http",
          url: "https://mcp.example.com/v1",
          headers: { Authorization: "Bearer ${TOKEN}" },
          auth: {
            CLIENT_ID: "${CLIENT_ID}",
            CLIENT_SECRET: "${CLIENT_SECRET}",
            scopes: ["read"],
          },
        }),
      ).toEqual({
        url: "https://mcp.example.com/v1",
        headers: { Authorization: "Bearer ${TOKEN}" },
        auth: {
          CLIENT_ID: "${CLIENT_ID}",
          CLIENT_SECRET: "${CLIENT_SECRET}",
          scopes: ["read"],
        },
      });
    });

    it("omits undefined and empty fields", () => {
      expect(
        emitCursorMcpServerEntry({
          transport: "stdio",
          command: "node",
        }),
      ).toEqual({
        type: "stdio",
        command: "node",
      });

      expect(
        emitCursorMcpServerEntry({
          transport: "http",
          url: "https://mcp.example.com",
        }),
      ).toEqual({
        url: "https://mcp.example.com",
      });
    });
  });

  describe("mcpConfigContentsEquivalent", () => {
    it("treats harness formatting differences as equivalent", () => {
      const live = `${JSON.stringify(
        {
          mcpServers: {
            alpha: { url: "https://example.com/mcp" },
          },
        },
        null,
        2,
      )}\n`;
      const serialized = JSON.stringify(
        {
          mcpServers: {
            alpha: {
              type: "http",
              url: "https://example.com/mcp",
              tools: ["*"],
            },
          },
        },
        null,
        2,
      );
      expect(mcpConfigContentsEquivalent(live, serialized)).toBe(true);
    });

    it("detects real server differences", () => {
      const left = JSON.stringify({
        mcpServers: { alpha: { url: "https://example.com/a" } },
      });
      const right = JSON.stringify({
        mcpServers: { alpha: { url: "https://example.com/b" } },
      });
      expect(mcpConfigContentsEquivalent(left, right)).toBe(false);
    });
  });
});
