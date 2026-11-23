import { describe, expect, it } from "bun:test";
import { createServer } from "node:net";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

async function closedLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describe("CLI refused connection", () => {
  it("reports connection refused instead of a timeout and exits 1", async () => {
    const context = await createTestContext("cli-refused-connection");
    const port = await closedLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const previousExit = process.exitCode;
    try {
      const result = await runCli(["mcp", "list"], {
        env: { HARNESSTAP_MCP_REGISTRY_URL: baseUrl },
      });
      expect(result.exitCode).toBe(1);
      const output = `${result.stderr}\n${result.stdout}`;
      expect(output).toContain(`Connection refused (3 attempts): ${baseUrl}`);
      expect(output).not.toContain("timed out");
      expect(output).not.toContain("Request timed out after 30000ms");
    } finally {
      await context.cleanup();
      process.exitCode = previousExit ?? 0;
    }
  });
});
