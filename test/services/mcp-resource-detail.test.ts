import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  extractMcpServerConfigFromFile,
  overlayMcpServerDetail,
  scopeMcpConfigToServer,
} from "../../src/services/mcp-resource-detail.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("mcp resource detail overlay", () => {
  it("extracts one server from a whole-file mcp.json document", () => {
    const content = extractMcpServerConfigFromFile(
      JSON.stringify({
        mcpServers: {
          alpha: { command: "alpha-mcp" },
          beta: { url: "https://example.com/mcp" },
        },
      }),
      "beta",
    );
    expect(content).toContain('"beta"');
    expect(content).toContain("https://example.com/mcp");
    expect(content).not.toContain("alpha-mcp");
  });

  it("scopes a live mcp.json document to one server, including mcp_servers keys", () => {
    const cursorShaped = scopeMcpConfigToServer(
      JSON.stringify({
        mcpServers: {
          alpha: { command: "alpha-mcp" },
          beta: { url: "https://example.com/mcp" },
        },
      }),
      "beta",
    );
    expect(cursorShaped).toContain('"beta"');
    expect(cursorShaped).toContain("https://example.com/mcp");
    expect(cursorShaped).not.toContain("alpha-mcp");

    const missing = scopeMcpConfigToServer(
      JSON.stringify({
        mcp_servers: {
          alpha: { command: "alpha-mcp" },
        },
      }),
      "beta",
    );
    expect(missing).toContain('"mcp_servers"');
    expect(missing).not.toContain("alpha-mcp");
    expect(missing).not.toContain('"beta"');

    expect(scopeMcpConfigToServer(null, "beta")).toBeNull();
  });

  it("reads live mcp.json for a snapshot resource with empty content", () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-mcp-detail-"));
    tempDirs.push(dir);
    const filePath = join(dir, "mcp.json");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(
        {
          mcpServers: {
            "mcp-agency-sandbox-public": {
              command: "npx",
              args: ["-y", "agency-sandbox"],
            },
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const liveMtime = new Date("2026-08-21T14:55:00.000Z");
    utimesSync(filePath, liveMtime, liveMtime);

    const overlay = overlayMcpServerDetail(
      {
        type: "mcp_server",
        name: "mcp-agency-sandbox-public",
        source: filePath,
        origin_ref: filePath,
        content: "",
        metadata: { transport: "stdio", command: "npx" },
        updated_at: "2026-08-02T15:25:00.000Z",
      },
      filePath,
    );

    expect(overlay.content).toContain("mcp-agency-sandbox-public");
    expect(overlay.content).toContain("agency-sandbox");
    expect(overlay.updatedAt).toBe(liveMtime.toISOString());
  });

  it("falls back to metadata when the live file is missing", () => {
    const overlay = overlayMcpServerDetail({
      type: "mcp_server",
      name: "docs",
      source: "manual",
      origin_ref: "",
      content: "",
      metadata: { transport: "stdio", command: "docs-mcp", args: ["--stdio"] },
      updated_at: "2026-08-02T15:25:00.000Z",
    });
    expect(overlay.content).toContain("docs-mcp");
    expect(overlay.updatedAt).toBe("2026-08-02T15:25:00.000Z");
  });
});
